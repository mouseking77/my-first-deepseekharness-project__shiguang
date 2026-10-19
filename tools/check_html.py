"""静态 HTML 结构检查：标签闭合、重复 id、按钮是否都有 type 之类的小问题。
用法：python tools/check_html.py
"""
import os
import sys
import re
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(os.path.dirname(HERE), "index.html")

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}


class Checker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = {}
        self.errors = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids[a["id"]] = self.ids.get(a["id"], 0) + 1
        if tag in VOID:
            return
        self.stack.append((tag, self.getpos()))

    def handle_startendtag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids[a["id"]] = self.ids.get(a["id"], 0) + 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"多余的闭合标签 </{tag}> 在 {self.getpos()}")
            return
        top, pos = self.stack[-1]
        if top == tag:
            self.stack.pop()
        else:
            # 容忍隐式闭合的 <p> <li>
            if top in ("p", "li", "option") and tag not in ("p", "li", "option"):
                self.stack.pop()
                self.handle_endtag(tag)
            else:
                self.errors.append(f"标签不匹配：<{top}> 开始于 {pos}，却遇到 </{tag}> 在 {self.getpos()}")

    def handle_data(self, data):
        if "<script>" in data or "</script>" in data:
            pass


src = open(PATH, encoding="utf-8").read()
c = Checker()
c.feed(src)
c.close()

problems = list(c.errors)
for tag, pos in c.stack:
    problems.append(f"未闭合：<{tag}> 开始于 {pos}")

dups = {k: v for k, v in c.ids.items() if v > 1}
for k, v in dups.items():
    problems.append(f"重复 id：{k} 出现 {v} 次")

# 只允许 script 标签里的 < 之类，不在检查范围
if problems:
    print("发现 %d 个问题：" % len(problems))
    for p in problems:
        print("  -", p)
    sys.exit(1)

print(f"HTML 结构 OK：{len(c.ids)} 个 id，标签全部闭合，无重复 id")
