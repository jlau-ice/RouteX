import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RouteX · 让每条线路各得其所",
  description:
    "聚合多个 Clash 订阅，沿用 iKuuu 分流规则，为 ChatGPT 和日常上网配置专属节点。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
