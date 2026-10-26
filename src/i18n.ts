/**
 * Interface text in English and Arabic. English strings are the keys, so code reads naturally and
 * a missing translation falls back to English. Obsidian keeps its interface language in
 * localStorage ("language"); Arabic is used when it starts with "ar".
 */
const AR: Record<string, string> = {
	// bar and output
	Copy: "نسخ",
	Run: "تشغيل",
	Stop: "إيقاف",
	"Copy code": "نسخ الشيفرة",
	"Run code": "تشغيل الشيفرة",
	"Copy output": "نسخ المخرجات",
	"Clear output": "مسح المخرجات",
	"Input for the program": "مدخلات البرنامج",
	"Type input for the program, then press Enter": "اكتب مدخلات البرنامج ثم اضغط Enter",
	"Running {name}… {time}": "يعمل {name}… {time}",
	"{name} preview": "معاينة {name}",
	"Finished · {time}": "انتهى · {time}",
	"Stopped · {time}": "أوقِف · {time}",
	"Couldn't run": "تعذّر التشغيل",
	"Exit code {code} · {time}": "رمز الخروج {code} · {time}",
	"HTML preview": "معاينة HTML",
	"… {n} earlier characters dropped (output limit in settings)": "… حُذف {n} حرفًا أقدم (حدّ المخرجات في الإعدادات)",
	"Stopped after {n} s (time limit in settings).": "أوقِف بعد {n} ث (الحدّ الزمني في الإعدادات).",
	"Click to copy": "انقر للنسخ",
	Copied: "نُسخ",
	"Code copied": "نُسخت الشيفرة",
	"Couldn't copy to the clipboard.": "تعذّر النسخ إلى الحافظة.",
	"Run file (Ctrl/Cmd + Enter)": "تشغيل الملف (Ctrl/Cmd + Enter)",
	"Copy file contents": "نسخ محتوى الملف",
	// running
	'Brief Coder can\'t run "{lang}" code blocks.': "لا يستطيع Brief Coder تشغيل كتل «{lang}».",
	"{lang} runs on Obsidian for desktop.": "تعمل {lang} في Obsidian لسطح المكتب.",
	"{lang} runs on Obsidian for desktop. On mobile, Brief Coder runs JavaScript and HTML.":
		"تعمل {lang} في Obsidian لسطح المكتب. على الجوال يشغّل Brief Coder لغتي JavaScript وHTML.",
	"Brief Coder can't run {lang} yet.": "لا يستطيع Brief Coder تشغيل {lang} بعد.",
	"{lang} isn't installed, or Obsidian can't find it (tried: {tried}).": "{lang} غير مثبّتة، أو لم يجدها Obsidian (جُرّب: {tried}).",
	"Install it, or set its command in Settings → Brief Coder → Languages.": "ثبّتها، أو حدّد أمرها في الإعدادات ← Brief Coder ← اللغات.",
	"Run this {lang} code?": "تشغيل شيفرة {lang} هذه؟",
	"From {path}. It runs on your computer with your permissions. Only run code you trust.":
		"من {path}. تعمل على حاسوبك بصلاحياتك. لا تشغّل إلا شيفرة تثق بها.",
	"It runs on your computer with your permissions. Only run code you trust.": "تعمل على حاسوبك بصلاحياتك. لا تشغّل إلا شيفرة تثق بها.",
	"Run {n} code blocks in this note?": "تشغيل {n} كتل شيفرة في هذه الملاحظة؟",
	"They run one after another: {list}. Stop all running code ends the sequence.":
		"تعمل واحدة بعد الأخرى: {list}. أمر «إيقاف كل الشيفرات» ينهي التسلسل.",
	Cancel: "إلغاء",
	"Run all": "تشغيل الكل",
	// commands
	"Run code block at cursor": "تشغيل كتلة الشيفرة عند المؤشر",
	"Copy code block at cursor": "نسخ كتلة الشيفرة عند المؤشر",
	"Run all code blocks in this note": "تشغيل كل كتل الشيفرة في هذه الملاحظة",
	"Clear all outputs in this note": "مسح كل المخرجات في هذه الملاحظة",
	"Stop all running code": "إيقاف كل الشيفرات العاملة",
	"Create new code file": "إنشاء ملف شيفرة جديد",
	"Run current code file": "تشغيل ملف الشيفرة الحالي",
	"Review agent changes": "مراجعة تغييرات الوكلاء",
	// new file
	"New code file": "ملف شيفرة جديد",
	"File name": "اسم الملف",
	"Created next to the current note. Include a folder to put it elsewhere, e.g. scripts/tool.py.":
		"يُنشأ بجانب الملاحظة الحالية. أضف مجلدًا لوضعه في مكان آخر، مثل scripts/tool.py.",
	Create: "إنشاء",
	"Add an extension, e.g. script.py or app.js": "أضف امتدادًا، مثل script.py أو app.js",
	".{ext} files aren't opened by Brief Coder. Add it in Settings → Brief Coder → Code files.":
		"ملفات ‎.{ext} لا يفتحها Brief Coder. أضفها في الإعدادات ← Brief Coder ← ملفات الشيفرة.",
	"{path} already exists.": "{path} موجود مسبقًا.",
	"Couldn't create {path}: {error}": "تعذّر إنشاء {path}: {error}",
	// settings
	"Code blocks": "كتل الشيفرة",
	"Show Run and Copy bar": "إظهار شريط التشغيل والنسخ",
	"A bar under each code block with the language, Copy, Run and the program's output.":
		"شريط أسفل كل كتلة شيفرة فيه اللغة والنسخ والتشغيل ومخرجات البرنامج.",
	"Hide Obsidian's copy button": "إخفاء زر النسخ في Obsidian",
	"Avoids two copy buttons on the same code block.": "يمنع ظهور زرّي نسخ على الكتلة نفسها.",
	"Click inline code to copy": "النقر على الشيفرة المضمّنة ينسخها",
	"In reading view, click any inline code to copy it.": "في وضع القراءة، انقر أي شيفرة مضمّنة لنسخها.",
	"Running code": "تشغيل الشيفرة",
	"Ask before running": "السؤال قبل التشغيل",
	"Confirm every run, wherever the note is.": "تأكيد كل تشغيل، أينما كانت الملاحظة.",
	"Trusted folders": "المجلدات الموثوقة",
	"Code in notes inside these folders runs on click; anywhere else, Brief Coder shows the code and asks first. One folder per line; / means the whole vault.":
		"تعمل الشيفرة في ملاحظات هذه المجلدات بنقرة؛ وفي غيرها يعرض Brief Coder الشيفرة ويسأل أولًا. مجلد في كل سطر؛ و/ تعني الخزنة كلها.",
	"Time limit (seconds)": "الحدّ الزمني (ثوانٍ)",
	"Stop programs that run longer than this. 0 = no limit (use Stop).": "يوقف البرامج التي تتجاوز هذه المدة. 0 = بلا حدّ (استخدم إيقاف).",
	"Output kept per run (KB)": "المخرجات المحفوظة لكل تشغيل (ك.ب)",
	"Older output is dropped beyond this, so endless printing can't slow Obsidian down.":
		"تُحذف المخرجات الأقدم بعد هذا الحدّ، فلا تُبطئ الطباعةُ المتواصلة Obsidian.",
	"Working folder for code blocks": "مجلد العمل لكتل الشيفرة",
	"Where relative paths in your code point to.": "المكان الذي تشير إليه المسارات النسبية في شيفرتك.",
	"The note's folder": "مجلد الملاحظة",
	"A temporary folder": "مجلد مؤقت",
	"JavaScript runs with": "تعمل JavaScript بواسطة",
	"Auto uses Node.js when it's installed, otherwise the in-app sandbox, which runs like JavaScript in a browser tab, with no access to your files or to Obsidian. Mobile always uses the sandbox.":
		"التلقائي يستخدم Node.js إن كان مثبّتًا، وإلا فالبيئة المعزولة داخل التطبيق، وهي تعمل مثل JavaScript في تبويب متصفح بلا وصول إلى ملفاتك أو إلى Obsidian. الجوال يستخدم البيئة المعزولة دائمًا.",
	Auto: "تلقائي",
	"In-app sandbox": "بيئة معزولة داخل التطبيق",
	"Code files": "ملفات الشيفرة",
	"Open these file types in Brief Coder": "فتح أنواع الملفات هذه في Brief Coder",
	"Comma-separated extensions. Reload Obsidian after changing this list.": "امتدادات مفصولة بفواصل. أعد تحميل Obsidian بعد تغيير القائمة.",
	"Line numbers": "أرقام الأسطر",
	"Wrap long lines": "التفاف الأسطر الطويلة",
	"Tab size": "حجم المسافة البادئة",
	Languages: "اللغات",
	"On mobile, Brief Coder runs JavaScript and HTML inside Obsidian. Other languages run in Obsidian for desktop.":
		"على الجوال يشغّل Brief Coder لغتي JavaScript وHTML داخل Obsidian. وتعمل اللغات الأخرى في Obsidian لسطح المكتب.",
	"Brief Coder uses the languages installed on this computer. Leave a command empty for the default, or enter a full path or extra options (for example /opt/homebrew/bin/python3.12).":
		"يستخدم Brief Coder اللغات المثبّتة على هذا الحاسوب. اترك الأمر فارغًا للافتراضي، أو أدخل مسارًا كاملًا أو خيارات إضافية (مثل ‎/opt/homebrew/bin/python3.12).",
	"Check installed languages": "فحص اللغات المثبّتة",
	"Shows which languages can run here and which program runs each one.": "يعرض اللغات التي تعمل هنا والبرنامج الذي يشغّل كلًّا منها.",
	Check: "فحص",
	"Checking…": "جارٍ الفحص…",
	"Check again": "إعادة الفحص",
	"Code blocks: {list}": "كتل الشيفرة: {list}",
	"{list} only": "{list} فقط",
	"Node.js not found — JavaScript runs in the in-app sandbox": "لم يُعثر على Node.js — تعمل JavaScript في البيئة المعزولة",
	"Not found — install it, or enter its path": "غير موجودة — ثبّتها أو أدخل مسارها",
	// agent bridge
	"Agent bridge": "جسر الوكلاء",
	"Let agents read this vault": "السماح للوكلاء بقراءة هذه الخزنة",
	"Off by default. When on, local agents such as Claude Code and Raqeeb can search and read notes in the folders below through coder-bridge.mjs, over stdio on this computer. Nothing is sent anywhere.":
		"معطّل افتراضيًا. عند تفعيله، يستطيع الوكلاء المحليون مثل Claude Code ورقيب البحث في ملاحظات المجلدات أدناه وقراءتها عبر coder-bridge.mjs على هذا الحاسوب فقط. لا يُرسل شيء إلى أي مكان.",
	"Folders agents can read": "المجلدات التي يقرؤها الوكلاء",
	"One per line; / means the whole vault. Hidden folders such as .obsidian are never shared.":
		"مجلد في كل سطر؛ و/ تعني الخزنة كلها. المجلدات المخفية مثل ‎.obsidian لا تُشارك أبدًا.",
	"Folders to keep private": "مجلدات تبقى خاصة",
	"Never shared, even inside a folder above.": "لا تُشارك أبدًا، حتى لو كانت داخل مجلد أعلاه.",
	"Let agents propose changes": "السماح للوكلاء باقتراح تغييرات",
	"Proposed changes are held: nothing is written until you accept them in Agent changes.":
		"التغييرات المقترحة معلّقة: لا يُكتب شيء حتى تقبلها في «تغييرات الوكلاء».",
	"Connect an agent": "ربط وكيل",
	"Download coder-bridge.mjs from the release, then add this to the agent's MCP settings (Claude Code: .mcp.json).":
		"نزّل coder-bridge.mjs من الإصدار، ثم أضف هذا إلى إعدادات MCP لدى الوكيل (Claude Code: ‎.mcp.json).",
	"Copy config": "نسخ الإعدادات",
	// agent changes
	"Agent changes": "تغييرات الوكلاء",
	"No agent changes yet.": "لا توجد تغييرات من الوكلاء بعد.",
	Refresh: "تحديث",
	Accept: "قبول",
	Reject: "رفض",
	Revert: "تراجع",
	"Show changes": "عرض التغييرات",
	"Hide changes": "إخفاء التغييرات",
	held: "معلّق",
	accepted: "مقبول",
	partly_accepted: "مقبول جزئيًا",
	rejected: "مرفوض",
	reverted: "متراجَع عنه",
	partly_reverted: "متراجَع عنه جزئيًا",
	added: "إضافة",
	changed: "تعديل",
	deleted: "حذف",
	applied: "طُبّق",
	conflict: "تعارض: تغيّر الملف بعد الاقتراح",
	skipped_changed: "تُرك: عدّلته بعد القبول",
	failed: "فشل",
	"{agent} proposed {n} changes. Review them in Agent changes.": "اقترح {agent} {n} تغييرات. راجعها في «تغييرات الوكلاء».",
	"Accepted {ok} of {n}. {skipped} skipped: the file changed after the proposal.":
		"قُبل {ok} من {n}. تُرك {skipped} لأن الملف تغيّر بعد الاقتراح.",
	"Reverted {ok} of {n}. {skipped} skipped: you changed them after accepting.":
		"تُراجع عن {ok} من {n}. تُرك {skipped} لأنك عدّلتها بعد القبول.",
	"Settings from Coder Studio were imported. You can remove the old coder-studio plugin.":
		"استُوردت إعدادات Coder Studio. يمكنك إزالة الإضافة القديمة coder-studio.",
};

let arabic: boolean | undefined;

export function isArabic(): boolean {
	if (arabic === undefined) {
		try {
			arabic = (globalThis.localStorage?.getItem("language") ?? "").toLowerCase().startsWith("ar");
		} catch {
			arabic = false;
		}
	}
	return arabic;
}

/** For tests. */
export function setArabic(on: boolean | undefined): void {
	arabic = on;
}

/** Translates `en` and fills `{name}` placeholders. */
export function t(en: string, vars?: Record<string, string | number>): string {
	const s = (isArabic() && AR[en]) || en;
	return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Keys with no Arabic text (tests use this to keep the table complete). */
export function hasArabic(en: string): boolean {
	return en in AR;
}
