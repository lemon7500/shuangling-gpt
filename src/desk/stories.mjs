/** Project-written fiction; these pages never use conversations or user notes. */
const STORY_ORDER = ['name-under-the-chimes', 'the-rose-keepsake', 'bookmark-within-reach', 'space-for-tomorrow', 'window-light', 'first-travel-entry'];
export const STORIES = Object.freeze([
  {
    id: 'bookmark-within-reach',
    title: { 'zh-CN': '歪了一点的书签', 'zh-TW': '歪了一點的書籤', en: 'A Slightly Crooked Bookmark' },
    body: {
      'zh-CN': '书库里的书签总要露出一样长的一截。霜铃离开故乡时，也把这条习惯带进了行囊。途经一间小小的抄写室，她看见桌角的书签歪着，便伸手把它理正。\n\n抄写员回来后，却先把书签挪到了另一侧。那边离常用的手更近，也不会挡住摊开的纸页。霜铃望了望整齐的桌边，又望了望那个顺手的位置，慢慢收回了手。\n\n傍晚，她在见闻集里写下：摆得端正，和放得合适，有时是两件事。写完之后，她没有再去挪那枚书签，只替窗边卷起的一角纸轻轻压了一下。',
      'zh-TW': '書庫裡的書籤總要露出一樣長的一截。霜鈴離開故鄉時，也把這條習慣帶進了行囊。途經一間小小的抄寫室，她看見桌角的書籤歪著，便伸手把它理正。\n\n抄寫員回來後，卻先把書籤挪到了另一側。那邊離常用的手更近，也不會擋住攤開的紙頁。霜鈴望了望整齊的桌邊，又望了望那個順手的位置，慢慢收回了手。\n\n傍晚，她在見聞集裡寫下：擺得端正，和放得合適，有時是兩件事。寫完之後，她沒有再去挪那枚書籤，只替窗邊捲起的一角紙輕輕壓了一下。',
      en: 'In the library, every bookmark showed the same length above its page. Shuangling carried that habit with her when she left home. At a small copying room along the road, she noticed a crooked bookmark at the corner of a desk and straightened it.\n\nWhen the copyist returned, they moved it to the other side. It was closer to their usual hand there and left the open pages clear. Shuangling looked at the neat edge, then at the convenient spot, and slowly withdrew her hand.\n\nThat evening she wrote in her travel journal: Being straight and being well placed are sometimes different things. She left the bookmark alone. Instead, she gently held down a corner of paper curling beside the window.',
    },
  },
  {
    id: 'space-for-tomorrow',
    title: { 'zh-CN': '没写满的一页', 'zh-TW': '沒寫滿的一頁', en: 'Room for Tomorrow' },
    body: {
      'zh-CN': '旅途中的第一篇见闻，只写了三行。霜铃把纸页翻来覆去，觉得余下的空白有些显眼。她想补上沿路的云，却记不清云的形状；又想画一盏灯，笔尖停了许久，还是没有落下。\n\n窗外的风铃响了一声。她忽然想起书库里那份没有结尾的手稿，想起自己正是带着一个没有答案的问题出发的。\n\n于是她在第三行后添了一个小小的日期，把本子合上。那一页没有被填满，也没有被撕去。第二天，她遇见一座挂着蓝布帘的旧书摊，才在空白处继续写下去。原来留出的位置，也可以等一个真正想记住的发现。',
      'zh-TW': '旅途中的第一篇見聞，只寫了三行。霜鈴把紙頁翻來覆去，覺得餘下的空白有些顯眼。她想補上沿路的雲，卻記不清雲的形狀；又想畫一盞燈，筆尖停了許久，還是沒有落下。\n\n窗外的風鈴響了一聲。她忽然想起書庫裡那份沒有結尾的手稿，想起自己正是帶著一個沒有答案的問題出發的。\n\n於是她在第三行後添了一個小小的日期，把本子合上。那一頁沒有被填滿，也沒有被撕去。第二天，她遇見一座掛著藍布簾的舊書攤，才在空白處繼續寫下去。原來留出的位置，也可以等一個真正想記住的發現。',
      en: 'Her first travel entry was only three lines long. Shuangling turned the page over and back, bothered by the space left empty. She considered adding the clouds along the road but could not remember their shapes. Then she thought of drawing a lamp. Her pen waited without touching the paper.\n\nA wind chime sounded outside. She remembered the unfinished manuscript in the library, and the unanswered question that had brought her on this journey.\n\nShe added a small date after the third line and closed the book. The page was neither filled nor torn out. The next day she found a secondhand bookstall behind a blue curtain and continued in that space. A place left blank could wait for something she truly wanted to remember.',
    },
  },
  {
    id: 'window-light',
    title: { 'zh-CN': '窗边的微光', 'zh-TW': '窗邊的微光', en: 'Light by the Window' },
    body: {
      'zh-CN': '午后的抄写室很安静，阳光一点点移过桌面。霜铃原本打算把借来的目录核对完，却被一条落在书脊上的细光吸引。她看了一会儿，又低头确认自己读到了哪一行。\n\n过了片刻，她把书签放好，合上目录，让尾巴在椅边绕了一个舒服的小弯。光不会因为她盯着就停住，书里的页码也不会趁她休息跑掉。\n\n那天的见闻集里没有特别了不起的事情。她只写了窗棂的影子、纸张晒暖后的气味，还有自己难得什么也没有整理的几分钟。收笔时，她轻轻笑了一下，觉得这一段空闲也值得留下。',
      'zh-TW': '午後的抄寫室很安靜，陽光一點點移過桌面。霜鈴原本打算把借來的目錄核對完，卻被一條落在書脊上的細光吸引。她看了一會兒，又低頭確認自己讀到了哪一行。\n\n過了片刻，她把書籤放好，合上目錄，讓尾巴在椅邊繞了一個舒服的小彎。光不會因為她盯著就停住，書裡的頁碼也不會趁她休息跑掉。\n\n那天的見聞集裡沒有特別了不起的事情。她只寫了窗櫺的影子、紙張曬暖後的氣味，還有自己難得什麼也沒有整理的幾分鐘。收筆時，她輕輕笑了一下，覺得這一段空閒也值得留下。',
      en: 'The copying room was quiet that afternoon. Sunlight moved slowly across the desk. Shuangling meant to finish checking a borrowed catalogue, but a thin line of light on a book spine caught her eye. She watched it for a while, then checked which line she had reached.\n\nSoon she placed her bookmark, closed the catalogue and curled her tail comfortably beside the chair. Watching the light would not make it stay, and the page numbers would not run away while she rested.\n\nNothing remarkable appeared in her journal that day: the window frame’s shadow, the smell of warm paper, and a few minutes in which she arranged nothing at all. She smiled as she put down her pen. That little interval was worth keeping, too.',
    },
  },
  {
    id: 'the-rose-keepsake',
    title: { 'zh-CN': '那枚玫瑰', 'zh-TW': '那枚玫瑰', en: 'The Rose Keepsake' },
    body: {
      'zh-CN': '完成记录者见习的那一天，霜铃收到一枚银灰色的玫瑰发饰。她先把纪念的小盒端端正正摆在桌上，又把刚核对过的目录翻了一遍，仿佛再确认一次，才好意思收下这份礼物。\n\n那段见习里，她修过旧书，也抄错过页码。有一次为了理齐所有书签，反倒忘了先把借书的位置记下来。她记得自己红着脸补上记录，也记得第二天仍被认真托付了新的纸页。\n\n如今每次出门，她都会轻轻扶正那枚玫瑰。它提醒她的不是从此不许出错，而是可以带着已经学会的东西继续走。至于还没学会的，见闻集里还有许多空白。',
      'zh-TW': '完成記錄者見習的那一天，霜鈴收到一枚銀灰色的玫瑰髮飾。她先把紀念的小盒端端正正擺在桌上，又把剛核對過的目錄翻了一遍，彷彿再確認一次，才好意思收下這份禮物。\n\n那段見習裡，她修過舊書，也抄錯過頁碼。有一次為了理齊所有書籤，反倒忘了先把借書的位置記下來。她記得自己紅著臉補上記錄，也記得第二天仍被認真託付了新的紙頁。\n\n如今每次出門，她都會輕輕扶正那枚玫瑰。它提醒她的不是從此不許出錯，而是可以帶著已經學會的東西繼續走。至於還沒學會的，見聞集裡還有許多空白。',
      en: 'On the day she finished her record keeper training, Shuangling received a silver-grey rose hair ornament. She placed its little box squarely on the desk and checked a catalogue once more, as though one last check might make it easier to accept the gift.\n\nDuring her training she had repaired books and copied page numbers incorrectly. Once, while aligning every bookmark, she forgot to record where a borrowed book belonged. She remembered blushing as she added the missing entry. She also remembered being trusted with new pages the next morning.\n\nNow she gently straightens the rose before going out. It does not tell her she must never make another mistake. It reminds her that she can carry what she has learned and keep walking. Her journal has plenty of space for what she has yet to learn.',
    },
  },
  {
    id: 'name-under-the-chimes',
    title: { 'zh-CN': '风铃下的名字', 'zh-TW': '風鈴下的名字', en: 'A Name Beneath the Chimes' },
    body: {
      'zh-CN': '霜境书库的清晨，窗沿常结着一层很薄的白霜。檐下的风铃被风碰响时，霜铃就知道，门边又有人带着新的纸页来了。她喜欢那声音，却很少急着跑去，只把手里的书签放稳，再抬头看看。\n\n有人问起她的名字，她想了一会儿，说“霜”像故乡的窗沿，也像自己的银白头发；“铃”则是那一声熟悉的招呼。说完，她的耳尖微微抬起，似乎也听见了很远处的轻响。\n\n离开书库以后，她遇见过许多不同的门和窗。有的地方没有风铃，她也能找到舒服的桌边。名字把故乡留在身上，却不妨碍她走到新的地方。',
      'zh-TW': '霜境書庫的清晨，窗沿常結著一層很薄的白霜。簷下的風鈴被風碰響時，霜鈴就知道，門邊又有人帶著新的紙頁來了。她喜歡那聲音，卻很少急著跑去，只把手裡的書籤放穩，再抬頭看看。\n\n有人問起她的名字，她想了一會兒，說「霜」像故鄉的窗沿，也像自己的銀白頭髮；「鈴」則是那一聲熟悉的招呼。說完，她的耳尖微微抬起，似乎也聽見了很遠處的輕響。\n\n離開書庫以後，她遇見過許多不同的門和窗。有的地方沒有風鈴，她也能找到舒服的桌邊。名字把故鄉留在身上，卻不妨礙她走到新的地方。',
      en: 'A thin white frost often lined the Frostrealm Library’s windows at dawn. When the wind touched the chimes beneath the eaves, Shuangling knew someone had arrived with new pages. She liked that sound, though she seldom hurried over. She would set down her bookmark securely, then look up.\n\nAsked about her name, she thought for a moment. Shuang, frost, recalled both the windowsills at home and her silver-white hair. Ling, bell, recalled that familiar greeting. Her ear tips lifted a little as she spoke, as if she could hear it somewhere far away.\n\nAfter leaving the library, she found many different doors and windows. Some had no chimes at all, but she could still find a comfortable place beside a desk. Her name let her carry home with her while making room for new places.',
    },
  },
  {
    id: 'first-travel-entry',
    title: { 'zh-CN': '第一条见闻', 'zh-TW': '第一條見聞', en: 'Her First Travel Entry' },
    body: {
      'zh-CN': '离开书库的第一天，霜铃走得并不远。她在一间开着窗的小屋借住，摊开自己的新本子，习惯性地先写日期，再留出目录的位置。可是接下来该记什么，她忽然拿不定主意。\n\n从前的记录总有明确的来源和页码，这一次，没有人把待核对的纸页交给她。她望了望窗边晾着的蓝布，看见布角被风轻轻托起，又慢慢落下。那不是什么大事，却让她看了很久。\n\n最后，她写道：“今天走过一段路，遇见一阵很轻的风。”字迹比平时松了一点。她没有重抄，只在旁边画了一小段弯线。见闻集终于有了第一条真正属于自己的记录。',
      'zh-TW': '離開書庫的第一天，霜鈴走得並不遠。她在一間開著窗的小屋借住，攤開自己的新本子，習慣性地先寫日期，再留出目錄的位置。可是接下來該記什麼，她忽然拿不定主意。\n\n從前的記錄總有明確的來源和頁碼，這一次，沒有人把待核對的紙頁交給她。她望了望窗邊晾著的藍布，看見布角被風輕輕托起，又慢慢落下。那不是什麼大事，卻讓她看了很久。\n\n最後，她寫道：「今天走過一段路，遇見一陣很輕的風。」字跡比平時鬆了一點。她沒有重抄，只在旁邊畫了一小段彎線。見聞集終於有了第一條真正屬於自己的記錄。',
      en: 'Shuangling did not travel far on her first day away from the library. Lodging in a small room with an open window, she spread out her new book. Out of habit she wrote the date and left space for a contents list. Then she stopped, unsure what to record.\n\nHer old records always came with clear sources and page numbers. This time nobody had handed her pages to check. She looked at a blue cloth drying by the window. Its corner lifted gently in the wind, then settled. It was a small thing, but she watched for a long time.\n\nAt last she wrote: “Today I followed a road and met a very light wind.” Her handwriting was looser than usual. She did not copy it out again, only drew a short curve beside it. The journal finally held its first entry that was truly her own.',
    },
  },
].sort((a, b) => STORY_ORDER.indexOf(a.id) - STORY_ORDER.indexOf(b.id))
  .map(story => Object.freeze({ ...story, title: Object.freeze(story.title), body: Object.freeze(story.body) })));

export const STORY_IDS = Object.freeze(STORIES.map(story => story.id));
