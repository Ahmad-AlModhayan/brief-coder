import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	DEFAULT_CODE_EXTENSIONS,
	codeOnly,
	prepareBatch,
	LANGUAGES,
	isDecoratedFence,
	languageById,
	languageForExtension,
	languageForFence,
	normaliseFenceLanguage,
	prepareC,
	prepareDart,
	prepareGo,
	prepareJava,
	preparePhp,
	prepareRust,
} from "../src/languages";
import { parseExtensionList } from "../src/settings";

describe("language registry", () => {
	it("has unique ids and aliases", () => {
		const ids = new Set<string>();
		const aliases = new Map<string, string>();
		for (const l of LANGUAGES) {
			assert.ok(!ids.has(l.id), `duplicate id ${l.id}`);
			ids.add(l.id);
			for (const a of l.aliases) {
				assert.equal(a, a.toLowerCase(), `alias ${a} must be lower-case`);
				assert.ok(!aliases.has(a), `alias ${a} used by ${aliases.get(a)} and ${l.id}`);
				aliases.set(a, l.id);
			}
			assert.ok(l.process || l.inApp, `${l.id} has no runner`);
		}
		assert.ok(LANGUAGES.length >= 40, `expected 40+ languages, got ${LANGUAGES.length}`);
	});

	it("resolves fence names case-insensitively, with attributes and braces", () => {
		assert.equal(languageForFence("Python")?.id, "python");
		assert.equal(languageForFence("py")?.id, "python");
		assert.equal(languageForFence("{python}")?.id, "python");
		assert.equal(languageForFence("{.js}")?.id, "javascript");
		assert.equal(languageForFence("c++")?.id, "cpp");
		assert.equal(languageForFence("c#")?.id, "csharp");
		assert.equal(languageForFence("golang")?.id, "go");
		assert.equal(languageForFence("mermaid"), undefined);
		assert.equal(normaliseFenceLanguage("  Rust title=x "), "rust");
	});

	it("maps file extensions", () => {
		assert.equal(languageForExtension("PY")?.id, "python");
		assert.equal(languageForExtension("rs")?.id, "rust");
		assert.equal(languageForExtension("h")?.id, "c");
		assert.equal(languageForExtension("hpp")?.id, "cpp");
		assert.equal(languageForExtension("unknown"), undefined);
		assert.equal(languageById("java")?.name, "Java");
	});

	it("decorates code fences but never rendered fences", () => {
		for (const f of ["python", "js", "", "json", "css", "yaml", "Python"]) assert.ok(isDecoratedFence(f), f);
		for (const f of ["mermaid", "dataview", "dataviewjs", "tasks", "query", "ad-note", "math", "base", "excalidraw", "made-up-thing"]) {
			assert.ok(!isDecoratedFence(f), f);
		}
	});

	it("default file extensions are valid and never include Markdown", () => {
		const parsed = parseExtensionList(DEFAULT_CODE_EXTENSIONS.join(", "));
		assert.equal(parsed.length, DEFAULT_CODE_EXTENSIONS.length);
		for (const ext of ["md", "canvas", "pdf", "png", "base"]) assert.ok(!parsed.includes(ext), ext);
		assert.deepEqual(parseExtensionList(".py, JS;;  ts  bad/ext, py"), ["py", "js", "ts"]);
	});
});

describe("snippet helpers", () => {
	it("PHP gets an opening tag once", () => {
		assert.equal(preparePhp('echo "hi";'), '<?php\necho "hi";');
		assert.equal(preparePhp("<?php echo 1;"), "<?php echo 1;");
	});

	it("Go gets package main and a main function", () => {
		const out = prepareGo('import "fmt"\nfmt.Println("hi")');
		assert.match(out, /^package main\n/);
		assert.match(out, /import "fmt"\nfunc main\(\) \{\n {4}fmt\.Println\("hi"\)\n\}/);
		const full = 'package main\nimport "fmt"\nfunc main() { fmt.Println(1) }';
		assert.equal(prepareGo(full), full);
		const funcs = 'import "fmt"\nfunc main() { fmt.Println(1) }';
		assert.equal(prepareGo(funcs), `package main\n\n${funcs}`);
	});

	it("Rust wraps statements but keeps use lines outside", () => {
		const out = prepareRust("use std::collections::HashMap;\nlet m: HashMap<i32, i32> = HashMap::new();\nprintln!(\"{}\", m.len());");
		assert.match(out, /^use std::collections::HashMap;\n\nfn main\(\) \{\n {4}let m/);
		assert.equal(prepareRust('fn main() { println!("x"); }'), 'fn main() { println!("x"); }');
	});

	it("Java wraps statements in Main", () => {
		const out = prepareJava("import java.util.*;\nSystem.out.println(new ArrayList<>(List.of(1)));");
		assert.match(out, /^import java\.util\.\*;\n\npublic class Main \{/);
		const cls = "public class Hello { public static void main(String[] a) {} }";
		assert.equal(prepareJava(cls), cls);
	});

	it("C and C++ get main and default includes", () => {
		const c = prepareC(false)('printf("%d\\n", 1 + 1);');
		assert.match(c, /#include <stdio\.h>/);
		assert.match(c, /int main\(void\) \{/);
		const cpp = prepareC(true)("#include <vector>\nvector<int> v{1,2};\ncout << v.size() << endl;");
		assert.match(cpp, /#include <iostream>\nusing namespace std;\n#include <vector>/);
		assert.match(cpp, /int main\(\) \{/);
		const full = "int main(){return 0;}";
		assert.equal(prepareC(true)(full), full);
	});

	it("Dart wraps statements in main", () => {
		assert.match(prepareDart("print('hi');"), /^void main\(\) \{\n {4}print\('hi'\);\n\}/);
	});

	it("isn't fooled by comments or strings when deciding to wrap", () => {
		assert.match(prepareJava("// The String class is immutable\nSystem.out.println(\"class Foo\");"), /public class Main/);
		assert.match(prepareC(false)('printf("main(%d)\\n", 1);'), /int main\(void\)/);
		assert.match(prepareGo('fmt.Println("func x()")'), /func main\(\)/);
		assert.match(prepareDart("// main() is added for you\nprint('hi');"), /void main\(\)/);
		assert.match(prepareRust("fn first<'a>(x: &'a str) -> &'a str { x }\nprintln!(\"{}\", first(\"hi\"));"), /fn main\(\)/);
		assert.equal(codeOnly('a /* b */ "c" \'d\' `e` // f').trim(), "a");
		assert.equal(codeOnly("x = 'it''s'", false), "x = 'it''s'"); // Rust mode keeps single quotes (lifetimes)
	});

	it("Batch gets UTF-8 output and Windows line endings", () => {
		assert.equal(prepareBatch("echo hi\necho there"), "@chcp 65001 >nul\r\necho hi\r\necho there");
		assert.equal(prepareBatch("@chcp 1256\necho x"), "@chcp 1256\r\necho x");
	});
});
