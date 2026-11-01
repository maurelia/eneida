import unicodedata, re, html, json, sys, os
src, out = sys.argv[1], sys.argv[2]
expected = [756, 804, 718, 705, 871, 901, 817, 731, 818, 908, 915, 952]
books = []
for i in range(1, 13):
    t = open(os.path.join(src, f"aen{i}.html"), encoding="utf-8").read()
    m = re.search(r"<h1>(.*?)</h1>", t, re.S) or re.search(r"<p class=pagehead>([^\n<]*)", t)
    title = m.group(1).strip()
    body = t[m.end():]
    body = re.split(r'<div class="footer"|<table', body)[0]
    body = body.replace('<p class="internal_navigation">', '')
    paras = []
    nums = []
    last = 0
    for p in re.findall(r"<p[^>]*>(.*?)(?=<p|$)", body, re.S):
        lines = []
        for l in re.split(r"<br\s*/?>", p):
            mk = re.search(r'<span style="font-size:[^"]*">\s*(\d+)\s*(?:</span>)?', l)
            l = re.sub(r'<span style="font-size:[^"]*">\s*\d+\s*(?:</span>)?', '', l)
            l = re.sub(r"<[^>]+>", "", l)
            l = html.unescape(l).replace("\xa0", " ")
            l = re.sub(r"\s+", " ", l).strip()
            l = unicodedata.normalize("NFC", "".join(c for c in unicodedata.normalize("NFD", l) if c != "̄"))
            if "sic orsus ab alto: Infandum" in l:   # verso 2.2-3 unido en la fuente
                a, c = l.split(" Infandum", 1)
                last += 1; lines.append(a); nums.append(last)
                l = "Infandum" + c
            if l:
                last = int(mk.group(1)) if mk else last + 1
                lines.append(l if mk is None and last % 5 else [l, last][0])
                nums.append(last)
        if lines:
            paras.append(lines)
    n = sum(len(x) for x in paras)
    print(i, title, n, expected[i - 1], "OK" if n == expected[i - 1] else "DIFF")
    bad = [(a, b) for a, b in zip(nums, nums[1:]) if b != a + 1]
    print("   jumps:", bad[:10])
    books.append({"title": title, "paras": paras, "nums": nums})
json.dump(books, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
