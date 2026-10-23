(function () {
  if (!location.hash.startsWith("#/")) return;
  var parts = location.hash.slice(2).split("/");
  var routes = { post: "posts", note: "notes", posts: "posts", notes: "notes", about: "about" };
  if (!routes[parts[0]]) return;
  var path = "/" + routes[parts[0]] + "/";
  if (parts[1]) {
    try { path += encodeURIComponent(decodeURIComponent(parts[1])) + "/"; }
    catch (error) { return; }
  }
  location.replace(path);
})();
