// RSS 源配置 — 定义所有 RSS 订阅源，分为 ai / dev / startup / hn-blogs 四组

/** RSS 源定义 */
export interface FeedSource {
  /** 源名称 */
  name: string
  /** RSS/Atom 订阅地址 */
  url: string
  /** 所属分组 */
  group: 'ai' | 'dev' | 'startup' | 'hn-blogs'
}

/**
 * 全部 RSS 订阅源列表
 * - ai: AI 领域博客与新闻
 * - dev: 开发者与技术博客
 * - startup: 创业与科技媒体
 * - hn-blogs: Hacker News 2025 年度热门博客（92 个）
 */
export const FEEDS: FeedSource[] = [
  // === ai 组 ===
  { name: 'Import AI', url: 'https://jack-clark.net/feed', group: 'ai' },
  { name: 'MIT 科技评论中文', url: 'https://www.mittrchina.com/rss', group: 'ai' },
  { name: 'Machine Learning Mastery', url: 'https://machinelearningmastery.com/feed/', group: 'ai' },

  // === dev 组 ===
  { name: '阮一峰', url: 'https://www.ruanyifeng.com/blog/atom.xml', group: 'dev' },
  { name: '少数派', url: 'https://sspai.com/feed', group: 'dev' },

  // === startup 组 ===
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', group: 'startup' },
  { name: 'Product Hunt', url: 'https://www.producthunt.com/feed', group: 'startup' },

  // === hn-blogs 组（HN 2025 年度热门博客，92 个） ===
  { name: 'simonwillison.net', url: 'https://simonwillison.net/atom/everything/', group: 'hn-blogs' },
  { name: 'jeffgeerling.com', url: 'https://www.jeffgeerling.com/blog.xml', group: 'hn-blogs' },
  { name: 'seangoedecke.com', url: 'https://www.seangoedecke.com/rss.xml', group: 'hn-blogs' },
  { name: 'krebsonsecurity.com', url: 'https://krebsonsecurity.com/feed/', group: 'hn-blogs' },
  { name: 'daringfireball.net', url: 'https://daringfireball.net/feeds/main', group: 'hn-blogs' },
  { name: 'ericmigi.com', url: 'https://ericmigi.com/rss.xml', group: 'hn-blogs' },
  { name: 'antirez.com', url: 'http://antirez.com/rss', group: 'hn-blogs' },
  { name: 'idiallo.com', url: 'https://idiallo.com/feed.rss', group: 'hn-blogs' },
  { name: 'maurycyz.com', url: 'https://maurycyz.com/index.xml', group: 'hn-blogs' },
  { name: 'pluralistic.net', url: 'https://pluralistic.net/feed/', group: 'hn-blogs' },
  { name: 'shkspr.mobi', url: 'https://shkspr.mobi/blog/feed/', group: 'hn-blogs' },
  { name: 'lcamtuf.substack.com', url: 'https://lcamtuf.substack.com/feed', group: 'hn-blogs' },
  { name: 'mitchellh.com', url: 'https://mitchellh.com/feed.xml', group: 'hn-blogs' },
  { name: 'dynomight.net', url: 'https://dynomight.net/feed.xml', group: 'hn-blogs' },
  { name: 'utcc.utoronto.ca/~cks', url: 'https://utcc.utoronto.ca/~cks/space/blog/?atom', group: 'hn-blogs' },
  { name: 'xeiaso.net', url: 'https://xeiaso.net/blog.rss', group: 'hn-blogs' },
  { name: 'devblogs.microsoft.com/oldnewthing', url: 'https://devblogs.microsoft.com/oldnewthing/feed', group: 'hn-blogs' },
  { name: 'righto.com', url: 'https://www.righto.com/feeds/posts/default', group: 'hn-blogs' },
  { name: 'lucumr.pocoo.org', url: 'https://lucumr.pocoo.org/feed.atom', group: 'hn-blogs' },
  { name: 'skyfall.dev', url: 'https://skyfall.dev/rss.xml', group: 'hn-blogs' },
  { name: 'garymarcus.substack.com', url: 'https://garymarcus.substack.com/feed', group: 'hn-blogs' },
  { name: 'overreacted.io', url: 'https://overreacted.io/rss.xml', group: 'hn-blogs' },
  { name: 'timsh.org', url: 'https://timsh.org/rss/', group: 'hn-blogs' },
  { name: 'johndcook.com', url: 'https://www.johndcook.com/blog/feed/', group: 'hn-blogs' },
  { name: 'gilesthomas.com', url: 'https://gilesthomas.com/feed/rss.xml', group: 'hn-blogs' },
  { name: 'matklad.github.io', url: 'https://matklad.github.io/feed.xml', group: 'hn-blogs' },
  { name: 'derekthompson.org', url: 'https://www.theatlantic.com/feed/author/derek-thompson/', group: 'hn-blogs' },
  { name: 'evanhahn.com', url: 'https://evanhahn.com/feed.xml', group: 'hn-blogs' },
  { name: 'terriblesoftware.org', url: 'https://terriblesoftware.org/feed/', group: 'hn-blogs' },
  { name: 'rakhim.exotext.com', url: 'https://rakhim.exotext.com/rss.xml', group: 'hn-blogs' },
  { name: 'joanwestenberg.com', url: 'https://joanwestenberg.com/rss', group: 'hn-blogs' },
  { name: 'xania.org', url: 'https://xania.org/feed', group: 'hn-blogs' },
  { name: 'micahflee.com', url: 'https://micahflee.com/feed/', group: 'hn-blogs' },
  { name: 'nesbitt.io', url: 'https://nesbitt.io/feed.xml', group: 'hn-blogs' },
  { name: 'construction-physics.com', url: 'https://www.construction-physics.com/feed', group: 'hn-blogs' },
  { name: 'tedium.co', url: 'https://feed.tedium.co/', group: 'hn-blogs' },
  { name: 'susam.net', url: 'https://susam.net/feed.xml', group: 'hn-blogs' },
  { name: 'entropicthoughts.com', url: 'https://entropicthoughts.com/feed.xml', group: 'hn-blogs' },
  { name: 'buttondown.com/hillelwayne', url: 'https://buttondown.com/hillelwayne/rss', group: 'hn-blogs' },
  { name: 'dwarkesh.com', url: 'https://www.dwarkeshpatel.com/feed', group: 'hn-blogs' },
  { name: 'borretti.me', url: 'https://borretti.me/feed.xml', group: 'hn-blogs' },
  { name: 'wheresyoured.at', url: 'https://www.wheresyoured.at/rss/', group: 'hn-blogs' },
  { name: 'jayd.ml', url: 'https://jayd.ml/feed.xml', group: 'hn-blogs' },
  { name: 'minimaxir.com', url: 'https://minimaxir.com/index.xml', group: 'hn-blogs' },
  { name: 'geohot.github.io', url: 'https://geohot.github.io/blog/feed.xml', group: 'hn-blogs' },
  { name: 'paulgraham.com', url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss', group: 'hn-blogs' },
  { name: 'filfre.net', url: 'https://www.filfre.net/feed/', group: 'hn-blogs' },
  { name: 'blog.jim-nielsen.com', url: 'https://blog.jim-nielsen.com/feed.xml', group: 'hn-blogs' },
  { name: 'dfarq.homeip.net', url: 'https://dfarq.homeip.net/feed/', group: 'hn-blogs' },
  { name: 'jyn.dev', url: 'https://jyn.dev/atom.xml', group: 'hn-blogs' },
  { name: 'geoffreylitt.com', url: 'https://www.geoffreylitt.com/feed.xml', group: 'hn-blogs' },
  { name: 'downtowndougbrown.com', url: 'https://www.downtowndougbrown.com/feed/', group: 'hn-blogs' },
  { name: 'brutecat.com', url: 'https://brutecat.com/rss.xml', group: 'hn-blogs' },
  { name: 'eli.thegreenplace.net', url: 'https://eli.thegreenplace.net/feeds/all.atom.xml', group: 'hn-blogs' },
  { name: 'abortretry.fail', url: 'https://www.abortretry.fail/feed', group: 'hn-blogs' },
  { name: 'fabiensanglard.net', url: 'https://fabiensanglard.net/rss.xml', group: 'hn-blogs' },
  { name: 'oldvcr.blogspot.com', url: 'https://oldvcr.blogspot.com/feeds/posts/default', group: 'hn-blogs' },
  { name: 'bogdanthegeek.github.io', url: 'https://bogdanthegeek.github.io/blog/index.xml', group: 'hn-blogs' },
  { name: 'hugotunius.se', url: 'https://hugotunius.se/feed.xml', group: 'hn-blogs' },
  { name: 'gwern.net', url: 'https://gwern.substack.com/feed', group: 'hn-blogs' },
  { name: 'berthub.eu', url: 'https://berthub.eu/articles/index.xml', group: 'hn-blogs' },
  { name: 'chadnauseam.com', url: 'https://chadnauseam.com/rss.xml', group: 'hn-blogs' },
  { name: 'simone.org', url: 'https://simone.org/feed/', group: 'hn-blogs' },
  { name: 'it-notes.dragas.net', url: 'https://it-notes.dragas.net/feed/', group: 'hn-blogs' },
  { name: 'beej.us', url: 'https://beej.us/blog/rss.xml', group: 'hn-blogs' },
  { name: 'hey.paris', url: 'https://hey.paris/index.xml', group: 'hn-blogs' },
  { name: 'danielwirtz.com', url: 'https://danielwirtz.com/rss.xml', group: 'hn-blogs' },
  { name: 'matduggan.com', url: 'https://matduggan.com/rss/', group: 'hn-blogs' },
  { name: 'refactoringenglish.com', url: 'https://refactoringenglish.com/index.xml', group: 'hn-blogs' },
  { name: 'worksonmymachine.substack.com', url: 'https://worksonmymachine.substack.com/feed', group: 'hn-blogs' },
  { name: 'philiplaine.com', url: 'https://philiplaine.com/index.xml', group: 'hn-blogs' },
  { name: 'steveblank.com', url: 'https://steveblank.com/feed/', group: 'hn-blogs' },
  { name: 'bernsteinbear.com', url: 'https://bernsteinbear.com/feed.xml', group: 'hn-blogs' },
  { name: 'danieldelaney.net', url: 'https://danieldelaney.net/feed', group: 'hn-blogs' },
  { name: 'troyhunt.com', url: 'https://www.troyhunt.com/rss/', group: 'hn-blogs' },
  { name: 'herman.bearblog.dev', url: 'https://herman.bearblog.dev/feed/', group: 'hn-blogs' },
  { name: 'tomrenner.com', url: 'https://tomrenner.com/index.xml', group: 'hn-blogs' },
  { name: 'blog.pixelmelt.dev', url: 'https://blog.pixelmelt.dev/rss/', group: 'hn-blogs' },
  { name: 'martinalderson.com', url: 'https://martinalderson.com/feed.xml', group: 'hn-blogs' },
  { name: 'danielchasehooper.com', url: 'https://danielchasehooper.com/feed.xml', group: 'hn-blogs' },
  { name: 'chiark.greenend.org.uk/~sgtatham', url: 'https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/feed.xml', group: 'hn-blogs' },
  { name: 'grantslatton.com', url: 'https://grantslatton.com/rss.xml', group: 'hn-blogs' },
  { name: 'experimental-history.com', url: 'https://www.experimental-history.com/feed', group: 'hn-blogs' },
  { name: 'anildash.com', url: 'https://anildash.com/feed.xml', group: 'hn-blogs' },
  { name: 'aresluna.org', url: 'https://aresluna.org/main.rss', group: 'hn-blogs' },
  { name: 'michael.stapelberg.ch', url: 'https://michael.stapelberg.ch/feed.xml', group: 'hn-blogs' },
  { name: 'miguelgrinberg.com', url: 'https://blog.miguelgrinberg.com/feed', group: 'hn-blogs' },
  { name: 'keygen.sh', url: 'https://keygen.sh/blog/feed.xml', group: 'hn-blogs' },
  { name: 'mjg59.dreamwidth.org', url: 'https://mjg59.dreamwidth.org/data/rss', group: 'hn-blogs' },
  { name: 'computer.rip', url: 'https://computer.rip/rss.xml', group: 'hn-blogs' },
]
