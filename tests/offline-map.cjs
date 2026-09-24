const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const http = require("node:http");
  const { build } = require("esbuild");
  const bundle = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; export {React,createRoot}; export {default} from "./src/MapView.jsx";', resolveDir: path.resolve('.') }, bundle: true, write: false, format: "esm", platform: "browser", loader: { ".css": "empty" }, define: { "import.meta.env.BASE_URL": '"/"', "process.env.NODE_ENV": '"production"' } });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    if (name === "/map.js") return res.writeHead(200, {"Content-Type":"text/javascript"}).end(bundle.outputFiles[0].contents);
    if (["/world.json", "/china.json", "/world-cities.json"].includes(name)) return res.writeHead(200, {"Content-Type":"application/json"}).end(fs.readFileSync(path.join("public", name.slice(1))));
    if (name === "/leaflet.css") return res.writeHead(200, {"Content-Type":"text/css"}).end(fs.readFileSync("node_modules/leaflet/dist/leaflet.css"));
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = 'http://127.0.0.1:' + server.address().port + '/';
  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const remote = [], errors = [];
    page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    page.on("requestfailed", request => console.error(request.url(), request.failure()));
    page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
    await page.route("**/*", route => {
      if (!route.request().url().startsWith(origin)) {
        remote.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.route("**/map-harness", route => route.fulfill({ contentType: "text/html", body: `
      <link rel="stylesheet" href="/leaflet.css"><div id="root"></div><style>html,body{margin:0}.map-shell,.map{height:700px;width:100%}.map-tools{position:absolute;right:15px;top:15px;z-index:1000}.map-caption,.map-legend,.map-coordinate{display:none}.gym-marker{background:red}.province-label,.city-label{white-space:nowrap}</style>
      <script type="module">
        const {default:MapView, React, createRoot}=await import("/map.js");
        const gyms=[{id:'new-york',name:'New York',lat:40.71,lng:-74},{id:'sydney',name:'Sydney',lat:-33.87,lng:151.21},{id:'date-line',name:'Date line',lat:-17,lng:179}];
        let state={gyms,onSelect:id=>window.selected=id,onPick:p=>window.picked=p,onHover:id=>{window.hover=id;render({hoveredId:id})},onHoverLeave:()=>{},onHoverGeometry:(id,visible)=>window.geometry={id,visible}};
        const root=createRoot(document.getElementById('root'));
        function render(next={}){state={...state,...next};root.render(React.createElement(MapView,state));} window.renderMap=render;render();
      </script>` }));
    await page.goto(origin + "map-harness");
    await expect(page.locator(".leaflet-control-attribution")).toContainText("Natural Earth");
    await expect(page.locator(".gym-marker")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "切换街道地图" })).toHaveCount(0);
    const marker = id => page.locator(`[data-gym-id="${id}"]`);
    const inMap = async id => {
      const b = await marker(id).boundingBox(), map = await page.locator(".map").boundingBox();
      return b && b.x >= map.x && b.x + b.width <= map.x + map.width && b.y >= map.y && b.y + b.height <= map.y + map.height;
    };
    assert.ok(await inMap("new-york")); assert.ok(await inMap("sydney")); assert.ok(await inMap("date-line"));
    await marker("new-york").hover();
    await expect.poll(() => page.evaluate(() => window.hover)).toBe("new-york");
    await marker("new-york").click();
    assert.equal(await page.evaluate(() => window.selected), "new-york");
    await page.evaluate(() => window.renderMap({ focus: { lat: 40.71, lng: -74, zoom: 7 } }));
    await expect.poll(() => inMap("sydney")).toBe(false);
    await expect(page.locator(".city-label")).not.toHaveCount(0);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect.poll(() => inMap("new-york")).toBe(true);
    await expect.poll(() => inMap("sydney")).toBe(false);
    await page.evaluate(() => window.renderMap({ focus: { lat: -33.87, lng: 151.21, zoom: 7 } }));
    await expect.poll(() => page.evaluate(() => window.geometry?.visible)).toBe(false);
    await page.getByRole("button", { name: "回到全球" }).click();
    await expect.poll(() => inMap("new-york")).toBe(true);
    await expect.poll(() => inMap("sydney")).toBe(true);
    await page.evaluate(() => window.renderMap({pick:true,focus:{lat:-17,lng:179,zoom:7}}));
    await page.waitForTimeout(400);
    await page.locator(".map").click({ position: { x: 480, y: 370 } });
    const picked = await page.evaluate(() => window.picked);
    assert.ok(picked && picked.lng >= -180 && picked.lng <= 180 && picked.lat >= -90 && picked.lat <= 90);
    assert.deepEqual(remote, []); assert.deepEqual(errors, []);
    const out = path.resolve("test-results/offline-map");fs.mkdirSync(out,{recursive:true});
    await page.getByRole("button", {name:"回到全球"}).click();
    await page.screenshot({path:path.join(out,"global.png")});
    console.log("PASS: local global map, overseas markers, hover/click, resize retention, hover visibility, global reset, date-line picking; zero external requests.");
  } catch (error) { console.error(error); throw error; } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
