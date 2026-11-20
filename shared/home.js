export const isHomePost = post => post.kind === "posts" && post.status === "published" && !post.sample;
export const isPublicProject = project => project.published !== false && !project.sample;

export function newestPosts(posts) {
  return posts.filter(isHomePost).sort((a, b) => b.date.localeCompare(a.date) || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
}

function inOrder(ids, items) {
  const byId = new Map(items.map(item => [item.id, item]));
  return ids.map(id => byId.get(id)).filter(Boolean);
}

export function homeSections(home, posts, projects) {
  const visible = projects.filter(isPublicProject);
  const post = ["post", home?.postIds == null ? newestPosts(posts).slice(0, 2) : inOrder(home.postIds, posts.filter(isHomePost))];
  const project = ["project", home ? inOrder(home.projectIds, visible) : visible.filter(item => item.showOnHome)];
  return home?.firstSection === "project" ? [project, post] : [post, project];
}
