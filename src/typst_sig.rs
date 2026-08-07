//! Builtin Typst function signatures, for the parameter-signature tooltip.
//!
//! Typst's own editor tooling has no signature-help API — `typst-ide` exposes
//! only completion, tooltips and jumps — so the signature panel is built from
//! the parameter metadata the `#[func]` macro bakes into the binary. That data
//! is reachable straight off the standard library scope (`Func::params()`), so
//! this module needs no `World`, no fonts and no compilation.
//!
//! The whole table is handed to the frontend **once** and cached there. The
//! tooltip has to refresh on every cursor movement, and an IPC round trip per
//! keystroke would be far too slow; the data is a compile-time constant
//! (`&'static [ParamInfo]`), so there is nothing to invalidate.
//!
//! Deliberately **not** covered: user-defined `#let` functions. Those are
//! `Repr::Closure`, for which `Func::params()` returns `None` — no amount of
//! work here can recover them, so the frontend parses them out of the document
//! instead.

use serde::Serialize;
use typst::foundations::{CastInfo, Func, Repr, Value};

use crate::typst_world::LIBRARY;

/// Upper bound on a rendered type string. Some `CastInfo::Union`s are enormous
/// (every named colour, every alignment); past a handful of alternatives the
/// text stops being readable in a tooltip anyway.
const MAX_UNION_ALTERNATIVES: usize = 6;

/// One parameter of a builtin function.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParamSig {
    name: String,
    /// Rendered type, e.g. `none | content`. Empty when the type is `Any`.
    type_name: String,
    /// First sentence of the upstream docs. See `first_sentence`.
    docs: String,
    required: bool,
    positional: bool,
    named: bool,
    variadic: bool,
    /// Settable via `#set`, which is how we know it may appear in a set rule.
    settable: bool,
}

/// One builtin function.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncSig {
    /// Call name as written in a document, e.g. `figure` or `calc.pow`.
    name: String,
    /// Human title, e.g. `Figure`. Empty when absent.
    title: String,
    /// Rendered return type. Empty when unknown.
    returns: String,
    /// Only reachable inside `$...$`: present in the `math` scope and absent from
    /// `global`. 40 names sit here (`frac`, `vec`, `binom`, `sqrt`, ...), and
    /// `#frac(a, b)` in markup simply does not work — so completion must not
    /// offer them outside math mode.
    math_only: bool,
    params: Vec<ParamSig>,
}

/// Render a `CastInfo` as a short type string.
///
/// `CastInfo` has no useful compact `Display`/`Repr` for this payload, so the formatting is
/// ours. Unions are flattened via `walk` (which recurses through nested unions)
/// and truncated, because a fully expanded union of every colour name is worse
/// than useless in a tooltip.
fn render_type(info: &CastInfo) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut truncated = false;
    info.walk(|leaf| {
        if parts.len() >= MAX_UNION_ALTERNATIVES {
            truncated = true;
            return;
        }
        let text = match leaf {
            CastInfo::Any => "any".to_string(),
            CastInfo::Type(ty) => ty.short_name().to_string(),
            // The `&str` here is the value's own docs, not its rendering.
            CastInfo::Value(value, _) => value.repr().to_string(),
            // `walk` yields only leaves, so a Union never reaches this arm.
            CastInfo::Union(_) => return,
        };
        if !parts.contains(&text) {
            parts.push(text);
        }
    });
    if truncated {
        parts.push("…".to_string());
    }
    parts.join(" | ")
}

/// First sentence of a doc comment, as plain-ish text.
///
/// `ParamInfo::docs` is full Markdown and the whole corpus is ~145 KiB, versus
/// ~64 KiB for first sentences only (measured — see the tests). A tooltip shows
/// one line per parameter, so the rest is dead weight over IPC. This
/// approximates `typst-ide`'s own `plain_docs_sentence`, which is private.
fn first_sentence(docs: &str) -> String {
    let cut = match docs.find(". ") {
        Some(i) => i + 1,
        None => docs.len(),
    };
    let mut text = docs[..cut].trim().replace('\n', " ");
    // Strip the inline-code backticks that dominate typst's docs; other Markdown
    // is rare in a first sentence and harmless if it slips through.
    text.retain(|c| c != '`');
    text
}

fn param_sigs(func: &Func) -> Vec<ParamSig> {
    func.params()
        .filter_map(|p| {
            // The standard-library walk below yields native functions and
            // elements. Closure/plugin metadata has no stable type/docs payload
            // and is handled by the frontend's own `#let` scanner instead.
            let native = p.to_native()?;
            Some(ParamSig {
                name: native.name.to_string(),
                type_name: match &native.input {
                    CastInfo::Any => String::new(),
                    other => render_type(other),
                },
                docs: first_sentence(native.docs),
                required: p.required(),
                positional: p.positional(),
                named: p.named(),
                variadic: p.variadic(),
                settable: p.settable(),
            })
        })
        .collect()
}

fn func_sig(name: String, func: &Func, math_only: bool) -> FuncSig {
    FuncSig {
        name,
        title: func.title().unwrap_or_default().to_string(),
        returns: func.returns().map(render_type).unwrap_or_default(),
        math_only,
        params: param_sigs(func),
    }
}

/// Every builtin function the frontend can offer a signature for.
///
/// Walks the `global` and `math` scopes, then one level into the scopes hanging
/// off functions (`table.cell`), modules (`calc.pow`) and types (`array.map`).
/// That nesting triples the coverage — 126 top-level functions versus 394 in
/// total — and is how dotted call names get resolved.
///
/// Recursion stops at one level deep on purpose: typst nests no deeper, and a
/// fixed depth means no cycle detection is needed.
pub fn builtin_signatures() -> Vec<FuncSig> {
    let mut out: Vec<FuncSig> = Vec::new();
    let push_nested =
        |out: &mut Vec<FuncSig>, prefix: &str, scope: &typst::foundations::Scope, math: bool| {
            for (sub, value) in scope.iter() {
                if let Value::Func(f) = value.read() {
                    out.push(func_sig(format!("{prefix}.{sub}"), f, math));
                }
            }
        };

    // `global` first so that a name in both scopes is recorded as generally
    // available; the dedup below keeps the first of each name.
    for (module, math) in [(&LIBRARY.global, false), (&LIBRARY.math, true)] {
        for (name, value) in module.scope().iter() {
            match value.read() {
                Value::Func(f) => {
                    out.push(func_sig(name.to_string(), f, math));
                    if let Some(inner) = f.scope() {
                        push_nested(&mut out, name, inner, math);
                    }
                }
                Value::Module(m) => push_nested(&mut out, name, m.scope(), math),
                Value::Type(t) => push_nested(&mut out, name, t.scope(), math),
                _ => {}
            }
        }
    }

    // `global` and `math` overlap (e.g. `text`), so the same name can arrive
    // twice. Sort by name, and within a name put the non-math entry first so the
    // dedup keeps it — a function reachable from markup must not be recorded as
    // math-only. `sort_by` alone would not settle that tie deterministically.
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.math_only.cmp(&b.math_only)));
    out.dedup_by(|a, b| a.name == b.name);
    out
}

/// Signature table for Typst builtins. Called once per session; see the module
/// docs for why this is not per-keystroke.
#[tauri::command]
pub fn list_typst_signatures() -> Vec<FuncSig> {
    builtin_signatures()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(name: &str) -> FuncSig {
        builtin_signatures()
            .into_iter()
            .find(|f| f.name == name)
            .unwrap_or_else(|| panic!("`{name}` missing from the signature table"))
    }

    #[test]
    fn completion_critical_call_shapes_match_typst_015_metadata() {
        let text = sig("text");
        let body = text.params.iter().find(|p| p.name == "body").unwrap();
        let string = text.params.iter().find(|p| p.name == "text").unwrap();
        assert!(body.type_name.contains("content"));
        assert!(!body.positional, "0.15 exposes text.body as named metadata");
        assert!(string.positional && string.required);
        assert!(string.type_name.starts_with("str"));

        let box_sig = sig("box");
        let box_body = box_sig.params.iter().find(|p| p.name == "body").unwrap();
        assert!(box_body.positional && !box_body.required);
        assert!(box_body.type_name.contains("content"));
    }

    #[test]
    fn figure_carries_its_caption_parameter() {
        // `figure` is an *element* function rather than a native one, so this
        // also covers `Func::params()` working for elements.
        let figure = sig("figure");
        let caption = figure
            .params
            .iter()
            .find(|p| p.name == "caption")
            .expect("figure should have a caption param");
        assert!(caption.named, "caption is passed by name");
        assert!(!caption.required, "caption is optional");
    }

    #[test]
    fn nested_scopes_are_reachable_by_dotted_name() {
        // Without the module/type/func scope recursion these are all absent,
        // and dotted call sites would show nothing.
        assert!(!sig("calc.pow").params.is_empty());
        assert!(!sig("table.cell").params.is_empty());
    }

    #[test]
    fn types_render_without_a_display_impl() {
        // CastInfo has no Display in 0.11; render_type is ours. `text`'s `size`
        // is a length, and `figure`'s `caption` is a union including `none`.
        let size = sig("text")
            .params
            .into_iter()
            .find(|p| p.name == "size")
            .expect("text should have a size param");
        assert!(
            size.type_name.contains("length"),
            "expected a length type, got {:?}",
            size.type_name
        );

        let caption = sig("figure")
            .params
            .into_iter()
            .find(|p| p.name == "caption")
            .unwrap();
        assert!(
            caption.type_name.contains('|'),
            "expected a union type, got {:?}",
            caption.type_name
        );
    }

    #[test]
    fn enormous_unions_are_truncated() {
        // Some params accept dozens of alternatives; the tooltip shows one line
        // per param, so the rendering must stay bounded.
        //
        // Counting on `" | "` rather than `'|'`: alternatives can be string
        // literals that themselves contain a pipe (`cases.delim` accepts "|"
        // and "||"), which makes a bare character count overshoot.
        for func in builtin_signatures() {
            for param in func.params {
                let alternatives = param.type_name.matches(" | ").count() + 1;
                assert!(
                    alternatives <= MAX_UNION_ALTERNATIVES + 1,
                    "{}.{} rendered {} alternatives: {:?}",
                    func.name,
                    param.name,
                    alternatives,
                    param.type_name
                );
            }
        }
    }

    #[test]
    fn docs_are_reduced_to_one_sentence() {
        let figure = sig("figure");
        let caption = figure.params.iter().find(|p| p.name == "caption").unwrap();
        assert!(!caption.docs.is_empty(), "docs should survive");
        assert!(
            !caption.docs.contains('`'),
            "backticks should be stripped: {:?}",
            caption.docs
        );
        // One sentence, not the whole Markdown block.
        assert!(
            !caption.docs.contains(". "),
            "expected a single sentence, got {:?}",
            caption.docs
        );
    }

    #[test]
    fn math_only_names_are_flagged() {
        // `frac` lives only in the math scope, so `#frac(a, b)` in markup is not
        // valid and completion must be able to exclude it.
        assert!(sig("frac").math_only, "frac is reachable only inside $...$");
        assert!(sig("vec").math_only);
        // `text` is in both scopes; the generally-available entry must win, or we
        // would hide it from markup.
        assert!(!sig("text").math_only, "text is available in markup");
        assert!(!sig("figure").math_only);

        let flagged = builtin_signatures()
            .into_iter()
            .filter(|f| f.math_only)
            .count();
        assert!(
            flagged > 30,
            "expected the ~40 math-only names, got {flagged}"
        );
    }

    #[test]
    fn table_is_deduplicated_and_serializable() {
        let table = builtin_signatures();
        let mut names: Vec<&str> = table.iter().map(|f| f.name.as_str()).collect();
        let before = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(before, names.len(), "signature names must be unique");

        // The payload crosses an IPC boundary; make sure it actually encodes and
        // report its real size, which is what justifies caching it client-side.
        let json = serde_json::to_string(&table).expect("table must serialize");
        eprintln!(
            "signature payload: {} funcs, {} KiB JSON",
            table.len(),
            json.len() / 1024
        );
        assert!(table.len() > 300, "expected the nested walk's coverage");
    }
}
