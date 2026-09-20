import { allowedPlatformUrl, platforms, type PlatformId } from "../src/domain";

// Some official login pages still return an HTTP creator URL. Upgrade only
// trusted platform destinations; never send the browser to the HTTP endpoint.
export function platformNavigationUrl(
  platform: PlatformId,
  value: string,
): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" && !url.port) url.protocol = "https:";
    if (!allowedPlatformUrl(platform, url.href)) return null;
    const returnParameter =
      platform === "zhihu" && url.pathname === "/signin"
        ? "next"
        : platform === "baijiahao" &&
            url.hostname === "baijiahao.baidu.com" &&
            url.pathname === "/builder/fe-react/stoken.html"
          ? "u"
          : null;
    if (returnParameter) {
      const next = url.searchParams.get(returnParameter);
      if (next) {
        try {
          const target = new URL(next, url.origin);
          if (target.protocol === "http:" && !target.port) {
            target.protocol = "https:";
            if (allowedPlatformUrl(platform, target.href))
              url.searchParams.set(returnParameter, target.href);
          }
        } catch {
          // A malformed optional return address must not block the login page.
        }
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

export function platformNavigationFilters(platform: PlatformId): string[] {
  const urls = platforms[platform].hosts.map((host) => `http://*.${host}/*`);
  if (platform === "zhihu") urls.push("https://*.zhihu.com/signin*");
  if (platform === "baijiahao")
    urls.push("https://baijiahao.baidu.com/builder/fe-react/stoken.html*");
  return urls;
}
