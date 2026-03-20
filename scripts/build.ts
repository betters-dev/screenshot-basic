(async () => {
  const { outputs } = await Bun.build({
    entrypoints: ["./ui/index.html"],
    drop: ["console", "debugger"],
    minify: true,
  });

  const [javaScriptCode, htmlCode] = await Promise.all(outputs.map((o) => o.text()));

  const transformedResponse = new HTMLRewriter()
    .on("script[src]", {
      element(element) {
        element
          .removeAttribute("src")
          .removeAttribute("crossorigin")
          .setAttribute("type", "module")
          .setInnerContent("\n" + javaScriptCode, {
            html: true,
          });
      },
    })
    .transform(new Response(htmlCode, { headers: { "Content-Type": "text/html" } }));

  const outputSize = await Bun.write("ui.html", transformedResponse);
  console.log(`Build ui.html success (${(outputSize / 1024).toFixed(2)} KB)`);
})();
