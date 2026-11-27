// Entry point for the generated essay pages (/essays/<slug>). The article itself is
// already in the HTML, so this only adds the interactive extras.
import { initTheme, startAnalytics } from "/assets/site.js";
import { enhanceArticle, initArticleUi, syncBookmark } from "/assets/article.js";

initTheme();
initArticleUi({ progress: true });
enhanceArticle(document.getElementById("article-body"));
syncBookmark();
startAnalytics();
