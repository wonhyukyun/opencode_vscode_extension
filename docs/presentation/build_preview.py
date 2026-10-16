"""Render opencode-integrated-talk.confluence.txt into an HTML preview.

Handles only the wiki markup subset the talk uses: panel, expand, color,
noformat, h1-h3, tables, * / # lists, {{mono}}, *bold*, ----.
"""
import html
import re
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "opencode-integrated-talk.confluence.txt"
OUT = HERE / "opencode-integrated-talk.preview.html"


def inline(text: str) -> str:
    text = html.escape(text, quote=False)
    text = re.sub(r"\{\{(.+?)\}\}", r"<code>\1</code>", text)
    text = re.sub(r"\{color:(#[0-9a-fA-F]{6})\}(.*?)\{color\}", r'<span style="color:\1">\2</span>', text)
    text = re.sub(r"(?<![\w*])\*(\S.*?\S|\S)\*(?![\w*])", r"<strong>\1</strong>", text)
    return text


def params(spec: str) -> dict:
    out = {}
    for part in spec.split("|"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k] = v
    return out


def render(src: str) -> str:
    lines = src.split("\n")
    out, i, para, lst = [], 0, [], None

    def flush():
        nonlocal para, lst
        if para:
            out.append("<p>" + "<br>".join(inline(l) for l in para) + "</p>")
            para = []
        if lst:
            out.append(f"</{lst}>")
            lst = None

    while i < len(lines):
        line = lines[i]
        if line.startswith("{noformat}"):
            flush()
            j = lines.index("{noformat}", i + 1)
            out.append("<pre>" + html.escape("\n".join(lines[i + 1 : j])) + "</pre>")
            i = j + 1
            continue
        m = re.match(r"^\{panel:(.*)\}$", line)
        if m:
            flush()
            p = params(m.group(1))
            style = f"background:{p.get('bgColor', '#ffffff')};border-color:{p.get('borderColor', 'var(--gray)')}"
            cls = "panel dark" if p.get("bgColor") == "#002f6d" else "panel"
            out.append(f'<section class="{cls}" style="{style}">')
            if "title" in p:
                out.append(f'<div class="ptitle">{html.escape(p["title"])}</div>')
            out.append('<div class="pbody">')
        elif line == "{panel}":
            flush()
            out.append("</div></section>")
        elif line.startswith("{expand:"):
            flush()
            out.append(f'<details><summary>{html.escape(line[8:-1])}</summary>')
        elif line == "{expand}":
            flush()
            out.append("</details>")
        elif line == "----":
            flush()
            out.append("<hr>")
        elif re.match(r"^h[1-3]\. ", line):
            flush()
            n = line[1]
            out.append(f"<h{n}>{inline(line[4:])}</h{n}>")
        elif line.startswith("||") or line.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append(lines[i])
                i += 1
            out.append("<table>")
            for r in rows:
                if r.startswith("||"):
                    cells = r.strip("|").split("||")
                    out.append("<tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells) + "</tr>")
                else:
                    cells = r.strip("|").split("|")
                    out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
            out.append("</table>")
            continue
        elif re.match(r"^[*#] ", line):
            if para:
                out.append("<p>" + "<br>".join(inline(l) for l in para) + "</p>")
                para = []
            tag = "ul" if line[0] == "*" else "ol"
            if lst != tag:
                if lst:
                    out.append(f"</{lst}>")
                out.append(f"<{tag}>")
                lst = tag
            out.append(f"<li>{inline(line[2:])}</li>")
        elif line.strip() == "":
            flush()
        else:
            if lst:
                out.append(f"</{lst}>")
                lst = None
            para.append(line)
        i += 1
    flush()
    return "\n".join(out)


PAGE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenCode Integrated 발표</title>
<style>
  :root {{
    --blue: #002f6d;   /* LIG Innovative Blue, PANTONE 294 C */
    --gray: #d0d3d4;   /* LIG Futuristic Gray, PANTONE 427 C */
    --ink: #1a1a1a;
    --paper: #ffffff;
  }}
  body {{ margin: 0; background: #f4f5f5; color: var(--ink);
         font-family: "Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; line-height: 1.65; }}
  main {{ max-width: 920px; margin: 0 auto; padding: 32px 16px 64px; background: var(--paper); }}
  .panel {{ border: 1px solid; border-radius: 3px; margin: 20px 0 0; overflow: hidden; }}
  .panel + .panel {{ margin-top: 0; border-top: none; }}
  .ptitle {{ background: var(--blue); color: #fff; font-weight: 700; padding: 8px 16px; letter-spacing: .02em; }}
  .pbody {{ padding: 4px 16px 8px; }}
  .dark h1, .dark h2, .dark h3 {{ margin: 8px 0; }}
  .dark {{ padding: 16px 8px; }}
  h1 {{ font-size: 2rem; }}
  table {{ border-collapse: collapse; width: 100%; margin: 12px 0; font-size: .95rem; }}
  th {{ background: var(--gray); color: var(--blue); text-align: left; }}
  th, td {{ border: 1px solid var(--gray); padding: 6px 10px; vertical-align: top; }}
  pre {{ background: #f7f8f8; border: 1px solid var(--gray); padding: 12px; overflow-x: auto; font-size: .8rem; line-height: 1.35; }}
  code {{ background: #eef0f0; padding: 1px 4px; border-radius: 2px; font-size: .9em; }}
  details {{ border-left: 3px solid var(--blue); margin: 8px 0 0; padding: 4px 12px; background: #fafbfb; }}
  summary {{ cursor: pointer; color: var(--blue); font-weight: 600; }}
  hr {{ border: none; border-top: 1px solid var(--gray); margin: 36px 0 16px; }}
</style>
</head>
<body><main>
{body}
</main></body>
</html>
"""

if __name__ == "__main__":
    OUT.write_text(PAGE.format(body=render(SRC.read_text(encoding="utf-8"))), encoding="utf-8")
    print(f"wrote {OUT.name}")
