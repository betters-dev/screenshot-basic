(async () => {
  // 1. Build the worker
  const workerBuild = await Bun.build({
    entrypoints: ["./ui/src/webworker.ts"],
    minify: true,
  });
  const workerCode = await workerBuild.outputs[0].text();

  // 2. Build the main UI
  const { outputs } = await Bun.build({
    entrypoints: ["./ui/index.html"],
    drop: ["console", "debugger"],
    minify: true,
  });

  let [javaScriptCode, htmlCode] = await Promise.all(outputs.map((o) => o.text()));

  // 3. Inject the worker as a blob URI into the JavaScript
  // We look for "new Worker('webworker.js')" and replace it with a blob-based one
  const workerBlobCode = `(() => {
        const __workerBlob = new Blob([${JSON.stringify(workerCode)}], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(__workerBlob));
    })()`.trim();

  javaScriptCode = javaScriptCode.replace(/new Worker\(['"]webworker\.js['"]\)/, workerBlobCode);

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
