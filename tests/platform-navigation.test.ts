import { platformIds, platforms } from "../src/domain";
import { describe, expect, it } from "vitest";
import {
  platformNavigationUrl,
  platformNavigationFilters,
} from "../electron/platform-navigation";

describe("知乎登录跳转", () => {
  it("登录返回创作页使用 HTTPS", () => {
    expect(
      platformNavigationUrl("zhihu", "http://zhuanlan.zhihu.com/write"),
    ).toBe("https://zhuanlan.zhihu.com/write");
    const login = platformNavigationUrl(
      "zhihu",
      "https://www.zhihu.com/signin?next=http%3A%2F%2Fzhuanlan.zhihu.com%2Fwrite",
    )!;
    expect(new URL(login).searchParams.get("next")).toBe(
      "https://zhuanlan.zhihu.com/write",
    );
  });
  it.each([
    "http://zhihu.com.evil.example/write",
    "http://user:secret@zhihu.com/write",
    "http://zhihu.com:8080/write",
    "javascript:alert(1)",
    "file:///tmp/index.html",
  ])("不会放行不安全地址 %s", (url) => {
    expect(platformNavigationUrl("zhihu", url)).toBeNull();
  });
  it("拒绝外部站点", () => {
    expect(platformNavigationUrl("zhihu", "https://evil.example/")).toBeNull();
  });
});

describe("百家号登录与注册跳转", () => {
  it.each([
    "http://baijiahao.baidu.com/builder/rc/home",
    "http://baijiahao.baidu.com/pcui/register/index?from=login",
    "http://passport.baidu.com/v2/?login",
  ])("官方旧链接升级为 HTTPS：%s", (url) => {
    expect(platformNavigationUrl("baijiahao", url)).toBe(
      url.replace("http:", "https:"),
    );
  });
  it("stoken 返回地址升级为 HTTPS 并保留参数", () => {
    const input = new URL(
      "https://baijiahao.baidu.com/builder/fe-react/stoken.html",
    );
    input.searchParams.set(
      "u",
      "http://baijiahao.baidu.com/builder/rc/home?from=login",
    );
    input.searchParams.set("test", "keep");
    const result = new URL(platformNavigationUrl("baijiahao", input.href)!);
    expect(result.searchParams.get("u")).toBe(
      "https://baijiahao.baidu.com/builder/rc/home?from=login",
    );
    expect(result.searchParams.get("test")).toBe("keep");
  });
  it.each([
    "http://baijiahao.baidu.com.evil.example/",
    "http://user:password@baijiahao.baidu.com/",
    "http://baijiahao.baidu.com:8080/",
    "https://unrelated.baidu.com/",
  ])("不扩大允许范围：%s", (url) => {
    expect(platformNavigationUrl("baijiahao", url)).toBeNull();
  });
});

describe("所有平台的通用导航策略", () => {
  it.each(platformIds.filter((id) => id !== "web"))(
    "%s 支持可信 HTTP 回跳且保留路径、查询和片段",
    (platform) => {
      const original = new URL(platforms[platform].url);
      original.searchParams.set("return", "a+b/c");
      original.hash = "editor";
      const expected = original.href;
      original.protocol = "http:";
      expect(platformNavigationUrl(platform, original.href)).toBe(expected);
      expect(platformNavigationUrl(platform, expected)).toBe(expected);
      expect(
        platformNavigationUrl(
          platform,
          "http://" + original.hostname + ".evil.example/path",
        ),
      ).toBeNull();
      expect(platformNavigationFilters(platform)).toContain(
        `http://*.${platforms[platform].hosts[0]}/*`,
      );
    },
  );
  it("不改写未知、签名或已为 HTTPS 的回调参数", () => {
    const url =
      "https://www.zhihu.com/signin?next=https%3A%2F%2Fzhuanlan.zhihu.com%2Fwrite&signed=a%20b";
    expect(platformNavigationUrl("zhihu", url)).toBe(url);
    const unknown =
      "https://mp.csdn.net/?redirect=http%3A%2F%2Fmp.csdn.net%2F&signature=a%20b";
    expect(platformNavigationUrl("csdn", unknown)).toBe(unknown);
  });
  it("畸形回调不阻止登录页打开", () => {
    const url = "https://www.zhihu.com/signin?next=http%3A%2F%2F%5B";
    expect(platformNavigationUrl("zhihu", url)).toBe(url);
  });
});
