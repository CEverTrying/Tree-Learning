import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sprout } from "lucide-react";
import { chromium } from "playwright";
const browser = await chromium.launch({
  ...(process.env.TREELEARNING_CHROMIUM
    ? { executablePath: process.env.TREELEARNING_CHROMIUM }
    : {}),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<body style="margin:0;background:transparent"><div style="width:512px;height:512px;display:grid;place-items:center;background:#26735c;border-radius:96px;color:white">${renderToStaticMarkup(React.createElement(Sprout, { size: 340, strokeWidth: 1.7 }))}</div></body>`,
  );
  await page.screenshot({ path: "public/icon.png", omitBackground: true });
} finally {
  await browser.close();
}
