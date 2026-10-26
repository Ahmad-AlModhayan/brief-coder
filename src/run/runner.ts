/** Chooses the right runner for a language and drives a RunSession through one run. */
import type { LanguageDef } from "../languages";
import { t } from "../i18n";
import type { CoderSettings } from "../settings";
import { startWorkerJs } from "./inapp";
import type { RunHandle, RunSession } from "./session";

export interface StartRunOptions {
	session: RunSession;
	lang: LanguageDef;
	/** Source text (code blocks, or a code file's current text). */
	code: string;
	/** Absolute path when running a code file in place (desktop). */
	filePath?: string;
	/** Absolute working directory for code blocks (desktop). */
	cwd?: string;
	settings: CoderSettings;
	/** Code blocks get boilerplate added (e.g. `main`); files run exactly as written. */
	isBlock: boolean;
	/** Running in the Electron desktop app (child processes available). */
	desktop: boolean;
}

/** Whether Coder can run this language on this device at all (controls the Run button). */
export function canRun(lang: LanguageDef | undefined, desktop: boolean): boolean {
	if (!lang) return false;
	if (lang.inApp) return true;
	return desktop && !!lang.process && (!lang.process.platforms || lang.process.platforms.includes(process.platform as "win32" | "darwin" | "linux"));
}

export async function startRun(o: StartRunOptions): Promise<void> {
	const { session, lang, settings } = o;
	if (session.running) return;
	session.buffer.maxChars = Math.max(16, settings.maxOutputKB) * 1024; // settings apply to the next run
	session.begin(lang.name);
	const source = o.isBlock && lang.prepare ? lang.prepare(o.code) : o.code;
	const stoppedEarly = (): boolean => {
		if (!session.cancelled) return false;
		session.finish({ code: null, signal: "SIGTERM" }, true);
		return true;
	};
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		if (lang.inApp === "html") {
			session.html = source;
			session.finish({ code: 0 });
			return;
		}
		// The time limit counts from the click, including finding and starting the tool.
		if (settings.timeoutSeconds > 0) {
			timer = setTimeout(() => {
				session.write("info", `\n${t("Stopped after {n} s (time limit in settings).", { n: settings.timeoutSeconds })}\n`);
				session.stop();
			}, settings.timeoutSeconds * 1000);
		}
		let handle: RunHandle;
		if (lang.inApp === "js" && (await useWorker(o))) {
			if (stoppedEarly()) return;
			session.command = "in-app (sandboxed worker)";
			handle = startWorkerJs(source, session);
		} else if (lang.process && o.desktop) {
			const { startProcessRun } = await import("./process");
			if (stoppedEarly()) return;
			handle = await startProcessRun({
				lang,
				settings,
				source,
				filePath: o.filePath,
				cwd: o.cwd,
				cacheKey: session.key,
				sink: session,
				isCancelled: () => session.cancelled,
				onCommand: (c) => (session.command = c),
			});
		} else {
			session.finish({
				code: null,
				error: o.desktop
					? t("Brief Coder can't run {lang} yet.", { lang: lang.name })
					: t("{lang} runs on Obsidian for desktop. On mobile, Brief Coder runs JavaScript and HTML.", { lang: lang.name }),
			});
			return;
		}
		session.handle = handle;
		if (session.cancelled) handle.stop(); // Stop arrived while the runner was starting
		const exit = await handle.done;
		session.finish(exit, session.stoppedByUser);
	} catch (e) {
		session.finish({ code: null, error: e instanceof Error ? e.message : String(e) });
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function useWorker(o: StartRunOptions): Promise<boolean> {
	if (!o.desktop || !o.lang.process) return true;
	if (o.settings.jsRuntime === "in-app") return true;
	if (o.settings.jsRuntime === "node") return false;
	// auto: Node.js when installed, otherwise the in-app worker.
	const { detect } = await import("./process");
	return (await detect(o.lang, o.settings)) === null;
}
