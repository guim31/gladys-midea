# Third-party notices

The Midea LAN protocol code in `src/midea/` is a port to JavaScript of parts of the
two projects below, both under the MIT license, whose notices follow. The
fixtures in `test/fixtures/msmart-vectors.json` were produced by running
msmart-ng and include frames from its test suite. The heat pump (0xC3) frames
in `src/midea/c3.js` are ported from midea-local, and
`test/fixtures/midea-local-c3-vectors.json` was produced by running it. The
dehumidifier (0xA1) commands in `src/midea/a1.js` are ported from midea-local
too, and `test/fixtures/midea-local-a1-vectors.json` was produced by running it.

## msmart-ng (https://github.com/mill1000/midea-msmart)

```text
MIT License

Copyright (c) 2022-2026 Tucker Kern
Copyright (c) 2020 Colin Kuebler (@kueblc)
Copyright (c) 2020 Mac_Zhou (@mac-zhou)
Copyright (c) 2018 NeoAcheron

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## midea-local (https://github.com/midea-lan/midea-local)

````text
MIT License

Copyright (c) 2026 Wentao Wu
Copyright (c) 2021 George Zhao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.```
````
