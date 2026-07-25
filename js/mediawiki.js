(function (global) {
  "use strict";

  function parsePageUrl(input) {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error("Enter a MediaWiki page URL.");
    }

    let url;
    try {
      url = new URL(trimmed);
    } catch (_err) {
      throw new Error("That does not look like a valid URL.");
    }

    const pageTitle = extractPageTitle(url);
    if (!pageTitle) {
      throw new Error("Could not find a page title in that URL.");
    }

    return {
      apiUrl: guessApiUrl(url),
      pageTitle: pageTitle,
    };
  }

  function extractPageTitle(url) {
    const wikiMatch = url.pathname.match(/\/wiki\/([^/?#]+)/);
    if (wikiMatch) {
      return decodeURIComponent(wikiMatch[1].replace(/\+/g, " "));
    }

    const titleParam = url.searchParams.get("title");
    if (titleParam) {
      return titleParam.replace(/\+/g, " ");
    }

    const indexMatch = url.pathname.match(/\/index\.php\/([^/?#]+)/);
    if (indexMatch) {
      return decodeURIComponent(indexMatch[1].replace(/\+/g, " "));
    }

    return null;
  }

  function guessApiUrl(url) {
    const wikiMatch = url.pathname.match(/^(.*)\/wiki\//);
    if (wikiMatch) {
      const prefix = wikiMatch[1];
      return url.origin + (prefix || "") + "/w/api.php";
    }

    const indexMatch = url.pathname.match(/^(.*)\/index\.php/);
    if (indexMatch) {
      const prefix = indexMatch[1];
      return url.origin + prefix + "/api.php";
    }

    return url.origin + "/w/api.php";
  }

  function htmlToPlainText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;

    body.querySelectorAll(
      "sup.reference, .mw-references-wrap, .navbox, .metadata, " +
        ".noprint, .ambox, .infobox, .hatnote, .shortdescription, " +
        "style, script"
    ).forEach(function (node) {
      node.remove();
    });

    return body.innerText
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function fetchPageText(apiUrl, pageTitle) {
    const params = new URLSearchParams({
      action: "parse",
      page: pageTitle,
      prop: "text",
      format: "json",
      origin: "*",
      disableeditsection: "1",
    });

    const response = await fetch(apiUrl + "?" + params.toString());
    if (!response.ok) {
      throw new Error("Wiki request failed (" + response.status + ").");
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.info || "The wiki returned an error.");
    }

    const html = data.parse && data.parse.text && data.parse.text["*"];
    if (!html) {
      throw new Error("No page content was returned.");
    }

    const text = htmlToPlainText(html);
    if (!text) {
      throw new Error("The page appears to be empty.");
    }

    return {
      title: (data.parse && data.parse.title) || pageTitle,
      text: text,
    };
  }

  async function loadFromUrl(pageUrl) {
    const parsed = parsePageUrl(pageUrl);
    let result;

    try {
      result = await fetchPageText(parsed.apiUrl, parsed.pageTitle);
    } catch (err) {
      if (parsed.apiUrl.endsWith("/w/api.php")) {
        try {
          const fallbackApi = parsed.apiUrl.replace("/w/api.php", "/api.php");
          result = await fetchPageText(fallbackApi, parsed.pageTitle);
        } catch (fallbackErr) {
          return fetchPageTextViaProxy(pageUrl, fallbackErr);
        }
      } else {
        return fetchPageTextViaProxy(pageUrl, err);
      }
    }

    return result;
  }

  async function fetchPageTextViaProxy(pageUrl, originalError) {
    let response;
    try {
      response = await fetch("api/fetch-wiki.php", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: new URLSearchParams({ url: pageUrl }),
      });
    } catch (_err) {
      throw new Error(
        "Could not reach api/fetch-wiki.php on this server. " +
          (originalError ? originalError.message : "Network error.")
      );
    }

    const rawBody = await response.text();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (_err) {
      throw new Error(
        "Server proxy returned an invalid response (HTTP " + response.status + "). Check Apache/PHP error logs."
      );
    }

    if (!response.ok || data.error) {
      throw new Error(data.error || "Could not load page through the server proxy.");
    }

    if (!data.text) {
      throw new Error("No page content was returned.");
    }

    return {
      title: data.title || pageUrl,
      text: data.text,
    };
  }

  global.MediaWikiLoader = {
    loadFromUrl: loadFromUrl,
    parsePageUrl: parsePageUrl,
  };
})(window);
