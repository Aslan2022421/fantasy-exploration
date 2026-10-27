# 本機預覽用的伺服器。跟 python -m http.server 一樣，但叫瀏覽器不要快取，
# 改完程式重新整理就一定拿到新版，不會新舊檔案混在一起。
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
root = os.path.dirname(os.path.abspath(__file__))
handler = functools.partial(NoCacheHandler, directory=root)
http.server.ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
