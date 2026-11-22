(() => {
  const app = document.querySelector('#app');
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const referenceThemes = { broadsheet: '大报 · 纽约时报', brief: '简报 · 经济学人', review: '书评 · 伦敦书评', glance: '要览 · Semafor', yorker: '周刊 · 纽约客', duan: '端 · 端传媒' };
  const earlierThemes = { espresso: '红刊', terminal: '终端', today: '今日', signal: '讯号', paper: '纸刊', pure: '素笺' };
  const themes = { ...referenceThemes, ...earlierThemes };
  const appearances = { auto: '自动', light: '浅色', dark: '深色' };
  const sections = { world: '全球局势', security: '战争与安全', macro: '金融宏观', tech: 'AI 与硬科技', bio: '生命科学与医学' };
  const eggTypes = ['thread', 'flaw', 'hunch'];
  let base = params.get('mock') === '1' ? 'mock' : 'data';
  let index = [], issue = null, read = new Set(), openId = null, pagerStep = null;
  let eggType = eggTypes.includes(params.get('egg')) ? params.get('egg') : null;
  const eggStates = new Map();
  const deepStates = new Map();
  let routeVersion = 0;

  const get = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const set = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const remove = key => { try { localStorage.removeItem(key); } catch {} };
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  };
  const button = (text, cls, action) => {
    const node = el('button', cls, text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const internalLink = (text, hash, cls) => {
    const node = el('a', cls, text);
    node.href = hash;
    return node;
  };
  const externalLink = (text, url, cls) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const link = el('a', cls, text);
        link.href = parsed.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        return link;
      }
    } catch {}
    return el('span', cls, text);
  };
  const paragraphs = (parent, text, cls) => {
    if (typeof text !== 'string' || !text.trim()) return;
    text.split(/\n\s*\n/).filter(Boolean).forEach(part => parent.append(el('p', cls, part)));
  };
  const dateParts = date => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
    if (!match) return null;
    const [, year, month, day] = match;
    const utc = new Date(Date.UTC(+year, +month - 1, +day));
    if (utc.toISOString().slice(0, 10) !== date) return null;
    const weekday = utc.getUTCDay();
    return { md: `${+month}月${+day}日`, weekday: `周${'日一二三四五六'[weekday]}`,
      long: `${year}年${+month}月${+day}日 星期${'日一二三四五六'[weekday]}`,
      short: `${month}/${day} ${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][weekday]}` };
  };
  const dateLabel = date => {
    const parts = dateParts(date);
    return parts ? `${parts.md} ${parts.weekday}` : (date || '');
  };
  const readKey = () => `brief:${base === 'mock' ? 'mock:' : ''}read:${issue.date}`;
  const loadRead = () => {
    try {
      const value = JSON.parse(get(readKey()) || '[]');
      return new Set(Array.isArray(value) ? value : []);
    } catch { return new Set(); }
  };
  const cleanRead = () => {
    try {
      const cutoff = Date.now() - 45 * 86400000;
      for (const key of Object.keys(localStorage)) {
        const match = /^brief:(?:mock:)?read:(\d{4}-\d{2}-\d{2})$/.exec(key);
        if (match && dateParts(match[1]) && Date.parse(`${match[1]}T00:00:00+08:00`) < cutoff) remove(key);
      }
    } catch {}
  };
  function applySettings() {
    const theme = params.get('theme');
    const appearance = params.get('appearance');
    root.dataset.theme = Object.hasOwn(themes, theme) ? theme : (Object.hasOwn(themes, get('brief:theme')) ? get('brief:theme') : 'broadsheet');
    root.dataset.appearance = Object.hasOwn(appearances, appearance) ? appearance : (Object.hasOwn(appearances, get('brief:appearance')) ? get('brief:appearance') : 'auto');
    if (Object.hasOwn(themes, theme)) set('brief:theme', theme);
    if (Object.hasOwn(appearances, appearance)) set('brief:appearance', appearance);
    updateThemeColor();
  }
  function updateThemeColor() {
    document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--bg').trim();
  }
  function chooseSetting(key, value) {
    if (key === 'theme' && root.dataset.theme !== value) { pagerStep = null; openId = null; }
    root.dataset[key] = value;
    set(`brief:${key}`, value);
    params.delete(key);
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
    updateThemeColor();
    render();
  }
  function settings() {
    const details = el('details', 'settings');
    details.open = settingsWasOpen;
    const summary = el('summary', 'settings-toggle', '设置');
    details.append(summary);
    const panel = el('div', 'settings-panel');
    function row(label, values, selected, callback, parent = panel) {
      const group = el('div', 'settings-row');
      group.append(el('span', 'settings-label', label));
      const choices = el('div', 'settings-choices');
      Object.entries(values).forEach(([value, name]) => {
        const choice = button(name, value === selected ? 'selected' : '', () => callback(value));
        choice.setAttribute('aria-pressed', String(value === selected));
        choices.append(choice);
      });
      group.append(choices);
      parent.append(group);
    }
    row('参考报刊', referenceThemes, root.dataset.theme, value => chooseSetting('theme', value));
    const older = el('details', 'older-themes');
    older.open = olderWasOpen || Object.hasOwn(earlierThemes, root.dataset.theme);
    older.append(el('summary', '', '更早的版本'));
    row('', earlierThemes, root.dataset.theme, value => chooseSetting('theme', value), older);
    panel.append(older);
    row('外观', appearances, root.dataset.appearance, value => chooseSetting('appearance', value));
    if (base === 'mock' && issue?.type === 'daily' && issue._mock?.egg_variants?.length) {
      const current = eggType || issue.egg?.type;
      const variants = Object.fromEntries(issue._mock.egg_variants.map(variant => [variant.type, variant.kicker || variant.type]));
      row('彩蛋玩法', variants, current, value => { eggType = value; render(); });
    }
    if (issue?.type === 'daily') panel.append(button('重置本期已读', 'reset-button', () => {
      read.clear();
      remove(readKey());
      openId = null;
      pagerStep = null;
      render();
    }));
    details.append(panel);
    return details;
  }
  function masthead(title, subtitle, progress, date, view) {
    const header = el('header', 'masthead');
    if (view) header.dataset.view = view;
    const parts = dateParts(date);
    if (root.dataset.theme === 'duan' && view) {
      const status = [view === 'weekly' ? '' : dateLabel(date), subtitle, progress ? `已读 ${progress}` : ''].filter(Boolean).join(' · ');
      header.append(el('div', 'duan-status', status));
    }
    if (parts) header.append(el('div', 'masthead-short-date', dateLabel(date)));
    const top = el('div', 'masthead-top');
    top.append(el('span', 'brand', '简报'));
    if (parts) {
      top.append(el('span', 'masthead-band-date', dateLabel(date)));
      top.append(el('span', 'masthead-ticker', `${parts.short}${progress ? ` · ${progress.replace(/\s/g, '')}` : ''}`));
    }
    const nav = el('nav', 'header-actions');
    nav.setAttribute('aria-label', '导航与设置');
    nav.append(internalLink('往期', '#/archive', 'nav-link'), settings());
    top.append(nav);
    header.append(top, el('h1', 'masthead-title', title));
    const meta = el('div', 'masthead-meta');
    if (parts) meta.append(el('span', 'masthead-long-date', parts.long));
    if (subtitle) meta.append(el('span', 'masthead-subtitle', subtitle));
    if (progress) meta.append(el('span', 'progress-count', progress));
    header.append(meta);
    if (root.dataset.theme === 'duan' && view === 'daily') {
      const sectionNav = el('nav', 'duan-sections');
      sectionNav.setAttribute('aria-label', '板块');
      Object.entries(sections).forEach(([key, name]) => sectionNav.append(internalLink(name, `#section-${key}`)));
      sectionNav.addEventListener('click', event => {
        const anchor = event.target.closest('a');
        if (!anchor) return;
        event.preventDefault();
        document.getElementById(anchor.getAttribute('href').slice(1))?.scrollIntoView({ block: 'start' });
      });
      header.append(sectionNav);
    }
    return header;
  }
  function labeled(parent, label, text, cls = '') {
    if (!text) return;
    const block = el('div', `text-block ${cls}`);
    block.append(el('h4', 'block-label', label));
    paragraphs(block, text);
    parent.append(block);
  }
  function deepSection(item) {
    const data = item.deep;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const key = JSON.stringify([base, issue.date, item.id]);
    const state = deepStates.get(key) || { open: false, revealed: false };
    deepStates.set(key, state);
    const section = el('section', 'deep-section');
    const content = el('div', 'deep-content');
    const duration = Number.isFinite(data.minutes) && data.minutes > 0 ? ` · 约 ${data.minutes} 分钟` : '';
    const toggle = button(`细读${duration}`, 'deep-toggle', () => {
      state.open = !state.open;
      content.hidden = !state.open;
      if (state.open) section.append(content); else content.remove();
      toggle.setAttribute('aria-expanded', String(state.open));
    });
    toggle.setAttribute('aria-expanded', String(state.open));
    content.hidden = !state.open;
    section.append(toggle);
    if (state.open) section.append(content);
    if (typeof data.background === 'string' && data.background.trim()) labeled(content, '来龙去脉', data.background, 'deep-background');
    const facts = Array.isArray(data.facts) ? data.facts.filter(text => typeof text === 'string' && text.trim()) : [];
    if (facts.length) {
      const block = el('div', 'deep-block deep-facts');
      block.append(el('h4', 'block-label', '事实与数字'));
      const list = el('ul', 'deep-fact-list');
      facts.forEach(text => list.append(el('li', '', text)));
      block.append(list); content.append(block);
    }
    const voices = Array.isArray(data.voices) ? data.voices.filter(voice => voice && typeof voice.who === 'string' && voice.who.trim() && typeof voice.says === 'string' && voice.says.trim()) : [];
    if (voices.length) {
      const block = el('div', 'deep-block deep-voices');
      block.append(el('h4', 'block-label', '各方怎么说'));
      voices.forEach(voice => {
        const entry = el('div', 'deep-voice');
        entry.append(el('strong', 'deep-who', voice.who));
        paragraphs(entry, voice.says);
        block.append(entry);
      });
      content.append(block);
    }
    if (typeof data.analysis === 'string' && data.analysis.trim()) labeled(content, '往深处想', data.analysis, 'deep-analysis');
    const takes = Array.isArray(data.takes) ? data.takes.filter(take => take && typeof take.text === 'string' && take.text.trim()) : [];
    if (takes.length) {
      const block = el('div', 'takes deep-takes');
      block.append(el('h4', 'block-label', '补充旁批'));
      takes.forEach(take => {
        const line = el('div', 'take');
        if (typeof take.label === 'string' && take.label.trim()) line.append(el('span', 'take-label', take.label));
        paragraphs(line, take.text); block.append(line);
      });
      content.append(block);
    }
    const drill = data.drill;
    if (drill && typeof drill === 'object' && typeof drill.question === 'string' && drill.question.trim()) {
      const block = el('div', 'deep-block deep-drill');
      const kind = typeof drill.kind === 'string' && drill.kind.trim() ? ` · ${drill.kind}` : '';
      block.append(el('h4', 'block-label', `想一想${kind}`));
      paragraphs(block, drill.question, 'deep-question');
      if (typeof drill.reveal === 'string' && drill.reveal.trim()) {
        const answer = el('div', 'deep-answer');
        paragraphs(answer, drill.reveal);
        answer.hidden = !state.revealed;
        const reveal = button(state.revealed ? '收起思路' : '看思路', 'deep-reveal', () => {
          state.revealed = !state.revealed;
          answer.hidden = !state.revealed;
          reveal.textContent = state.revealed ? '收起思路' : '看思路';
          reveal.setAttribute('aria-expanded', String(state.revealed));
        });
        reveal.setAttribute('aria-expanded', String(state.revealed));
        block.append(reveal, answer);
      }
      content.append(block);
    }
    return section;
  }
  function updateRead(id, value) {
    if (value) read.add(id); else read.delete(id);
    set(readKey(), JSON.stringify([...read]));
    openId = null;
    render();
    if (value) {
      const cards = [...app.querySelectorAll('.news-card')];
      const current = cards.findIndex(card => card.dataset.id === String(id));
      const next = [...cards.slice(current + 1), ...cards.slice(0, current)].find(card => !card.classList.contains('is-read'));
      if (next) next.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }
  function card(item, number) {
    const isRead = read.has(item.id);
    const expanded = openId === item.id;
    const article = el('article', `news-card${isRead ? ' is-read' : ''}${expanded ? ' is-open' : ''}`);
    article.dataset.id = item.id;
    article.dataset.section = item.section;
    if (root.dataset.theme === 'review') article.dataset.n = String(number);
    if (number === 1 && ['glance', 'duan'].includes(root.dataset.theme)) article.classList.add('is-lead');
    if (root.dataset.theme === 'glance' && number > 1 && number % 2 === 1) article.classList.add('glance-right');
    const head = button('', 'card-header', () => {
      openId = expanded ? null : item.id;
      const focused = document.activeElement === head;
      render();
      if (focused) [...app.querySelectorAll('.news-card')].find(card => card.dataset.id === String(item.id))?.querySelector('.card-header').focus({ preventScroll: true });
    });
    head.setAttribute('aria-expanded', String(expanded));
    const mark = el('span', 'read-mark', isRead ? '✓' : '');
    mark.setAttribute('aria-hidden', 'true');
    const cardIndex = el('span', 'card-index', String(number).padStart(2, '0'));
    cardIndex.dataset.number = String(number);
    cardIndex.setAttribute('aria-hidden', 'true');
    const content = el('span', 'card-heading');
    const cardSection = el('span', 'card-section', Object.hasOwn(sections, item.section) ? sections[item.section] : item.section || '');
    cardSection.setAttribute('aria-hidden', 'true');
    if (root.dataset.theme === 'review') content.append(el('span', 'review-meta', `第 ${number} 条 · 共 ${item.source_count ?? item.sources?.length ?? 0} 家报道`));
    content.append(cardSection);
    if (item.kind === 'update' && (!isRead || expanded || root.dataset.theme === 'yorker')) content.append(el('span', 'update-label', '进展'));
    content.append(el('span', 'card-title', item.title || ''));
    if (root.dataset.theme === 'review') content.append(el('span', 'review-author', Object.hasOwn(sections, item.section) ? sections[item.section] : item.section || ''));
    if ((!isRead || ['review', 'glance', 'yorker', 'duan'].includes(root.dataset.theme)) && item.gist) content.append(el('span', 'card-gist', item.gist));
    if (['yorker', 'duan'].includes(root.dataset.theme)) {
      const count = item.source_count ?? item.sources?.length;
      if (count != null) {
        const prefix = root.dataset.theme === 'duan' && number === 1 ? `${sections[item.section] || item.section || ''} / ` : '';
        content.append(el('span', 'card-byline', `${prefix}${count} 家报道`));
      }
      if (root.dataset.theme === 'yorker') {
        if (isRead) content.append(el('span', 'card-read-label', '已读'));
        content.append(el('span', 'card-toggle-label', expanded ? '收起' : '展开'));
      }
    }
    head.append(mark, cardIndex, content, el('span', 'card-chevron', expanded ? '−' : '+'));
    article.append(head);
    if (expanded) {
      const body = el('div', 'card-body');
      labeled(body, '核心事实', item.facts);
      labeled(body, '为什么重要', item.why);
      labeled(body, '后续看点', item.watch);
      if (Array.isArray(item.takes) && item.takes.length) {
        const takes = el('div', 'takes');
        takes.append(el('h4', 'block-label', '旁批'));
        item.takes.forEach(take => {
          const line = el('div', 'take');
          if (take.label) line.append(el('span', 'take-label', take.label));
          paragraphs(line, take.text);
          takes.append(line);
        });
        body.append(takes);
      }
      if (item.craft) {
        const craft = el(root.dataset.theme === 'review' ? 'div' : 'details', 'craft');
        craft.append(el(root.dataset.theme === 'review' ? 'h4' : 'summary', root.dataset.theme === 'review' ? 'block-label' : '', '巧思拆解'));
        paragraphs(craft, item.craft);
        body.append(craft);
      }
      const deep = deepSection(item);
      if (deep) body.append(deep);
      const sources = Array.isArray(item.sources) ? item.sources : [];
      if (sources.length || item.basis === 'summary' || item.basis === 'single') {
        const line = el('div', 'sources');
        if (sources.length) {
          line.append(document.createTextNode('信源：'));
          sources.forEach((source, i) => {
            if (i) line.append(document.createTextNode(' · '));
            line.append(externalLink(source.name || '', source.url));
          });
          if (item.source_count > sources.length) line.append(el('span', 'source-count', `（共 ${item.source_count} 家报道）`));
        }
        if (item.basis === 'summary' || item.basis === 'single') line.append(el('span', 'basis', item.basis === 'summary' ? '仅据摘要' : '单一信源'));
        body.append(line);
      }
      if (root.dataset.theme === 'review') {
        const sidebar = el('aside', 'review-sidebar');
        for (const selector of [':scope > .takes', ':scope > .craft']) {
          const node = body.querySelector(selector);
          if (node) sidebar.append(node);
        }
        const sourceLine = body.querySelector(':scope > .sources');
        if (deep) { deep.remove(); sourceLine?.remove(); }
        else if (sourceLine) sidebar.append(sourceLine);
        const columns = el('div', 'review-columns');
        const prose = el('div', 'review-prose');
        while (body.firstChild) prose.append(body.firstChild);
        columns.append(prose, sidebar);
        body.append(columns);
        if (deep) {
          body.append(deep);
          if (sourceLine) {
            const sources = el('aside', 'review-sidebar review-sources');
            sources.append(sourceLine); body.append(sources);
          }
        }
      }
      body.append(button(isRead ? '标为未读' : '读完了', 'read-button', () => updateRead(item.id, !isRead)));
      article.append(body);
    }
    return article;
  }
  function eggCard() {
    const variants = issue._mock?.egg_variants;
    const egg = base === 'mock' && eggType && Array.isArray(variants) ? variants.find(v => v.type === eggType) || issue.egg : issue.egg;
    if (!egg) return null;
    const stateKey = `${base}:${issue.date}:${egg.type}`;
    const saved = eggStates.get(stateKey);
    const block = el('aside', 'egg');
    block.append(el('h2', 'section-label', `今日彩蛋${egg.kicker ? ` · ${egg.kicker}` : ''}`));
    paragraphs(block, egg.question, 'egg-question');
    const reveal = el('div', 'egg-reveal');
    reveal.hidden = saved === undefined;
    paragraphs(reveal, egg.reveal);
    const controls = el('div', 'egg-controls');
    const revealWith = selected => {
      controls.querySelectorAll('button').forEach(b => {
        b.classList.toggle('selected', b === selected);
        b.setAttribute('aria-pressed', String(b === selected));
      });
      eggStates.set(stateKey, [...controls.children].indexOf(selected));
      reveal.hidden = false;
    };
    if (Array.isArray(egg.options) && egg.options.length) {
      egg.options.forEach(option => {
        const choice = button(option, 'egg-button', () => revealWith(choice));
        controls.append(choice);
      });
    } else controls.append(button('揭晓', 'egg-button', event => revealWith(event.currentTarget)));
    if (saved !== undefined && controls.children[saved]) {
      controls.children[saved].classList.add('selected');
      controls.children[saved].setAttribute('aria-pressed', 'true');
    }
    block.append(controls, reveal);
    return block;
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = el('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const success = document.execCommand('copy');
      textarea.remove();
      if (!success) throw new Error('copy failed');
    }
  }
  function endBlock(weekly, total, count) {
    const end = el('footer', `end-block${weekly || count === total ? ' is-done' : ''}`);
    const mark = el('span', 'end-mark');
    mark.setAttribute('aria-hidden', 'true');
    end.append(mark);
    if (weekly) end.append(el('p', 'end-title', '本周已读完。周一见。'));
    else if (count === total) {
      end.append(el('p', 'end-title', '今日已读完'), el('p', 'end-note', '到此为止。下一期明早 6:30。'));
    } else if (root.dataset.theme === 'brief') {
      end.append(el('p', 'end-title', `还剩 ${total - count} 条`));
      end.append(button('跳转第一条未读', 'pager-unread', () => {
        pagerStep = (issue.items || []).findIndex(item => !read.has(item.id));
        render(); window.scrollTo(0, 0);
      }));
    } else end.append(el('p', 'end-title', `今天共 ${total} 条，还剩 ${total - count} 条。`));
    if (issue.reflection) {
      const reflection = el('div', 'reflection');
      const label = weekly ? '本周一念' : '今日一念';
      reflection.append(el('h2', 'section-label', label));
      paragraphs(reflection, issue.reflection);
      const copy = button('复制', 'copy-button', async () => {
        try {
          await copyText(`${label}（${dateParts(issue.date)?.md || issue.date}）：${issue.reflection}`);
          copy.textContent = '已复制';
          setTimeout(() => { copy.textContent = '复制'; }, 1500);
        } catch { copy.textContent = '复制失败'; }
      });
      reflection.append(copy);
      end.append(reflection);
    }
    return end;
  }
  function openStory(id) {
    openId = id;
    render();
    requestAnimationFrame(() => [...app.querySelectorAll('.news-card')].find(node => node.dataset.id === String(id))?.scrollIntoView({ block: 'start' }));
  }
  function glanceList(items) {
    const aside = el('aside', 'glance-list');
    aside.append(el('h2', '', '今日一览'));
    const date = new Date(issue.generated_at);
    if (issue.generated_at && !Number.isNaN(date.getTime())) {
      aside.append(el('p', 'glance-time', `更新于 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)}`));
    }
    const list = el('ol');
    items.forEach(item => {
      const li = el('li', read.has(item.id) ? 'is-read' : '');
      const jump = button('', 'glance-jump', () => openStory(item.id));
      jump.append(el('strong', '', item.title || ''));
      if (item.gist) jump.append(document.createTextNode(` ${item.gist}`));
      li.append(jump); list.append(li);
    });
    aside.append(list);
    return aside;
  }
  function reviewIndex(items) {
    const band = el('aside', 'review-index');
    const heading = el('div', 'review-index-heading');
    heading.append(el('p', '', dateLabel(issue.date)), el('h2', '', '本期目录'));
    const list = el('div', 'review-index-list');
    items.forEach(item => {
      const label = Object.hasOwn(sections, item.section) ? sections[item.section] : item.section || '';
      list.append(button(`${label}：${item.title || ''}`, read.has(item.id) ? 'is-read' : '', () => openStory(item.id)));
    });
    band.append(heading, list);
    return band;
  }
  function layoutReviewGrid(grid) {
    let row = [], used = 0;
    const finish = () => {
      if (row.length) {
        const last = row[row.length - 1];
        last.style.setProperty('--review-span', Number(last.style.getPropertyValue('--review-span')) + 4 - used);
      }
      row = []; used = 0;
    };
    grid.querySelectorAll('.news-card').forEach(card => {
      if (card.classList.contains('is-open')) {
        finish();
        card.style.setProperty('--review-span', 4);
        return;
      }
      const position = Number(card.dataset.n) % 6;
      const span = position === 1 || position === 0 ? 2 : 1;
      if (used + span > 4) finish();
      card.style.setProperty('--review-span', span);
      row.push(card); used += span;
      if (used === 4) finish();
    });
    finish();
  }
  function pagerBar(label, items, hasEgg, weeklyView = false) {
    const bar = el('div', 'brief-bar');
    bar.append(el('strong', 'brief-bar-label', label), el('span', 'brief-bar-date', dateLabel(issue.date)));
    if (!weeklyView) {
      const pager = el('div', 'pager-controls');
      const max = items.length + (hasEgg ? 1 : 0);
      const prev = button('‹', 'pager-prev', () => movePager(-1));
      const next = button('›', 'pager-next', () => movePager(1));
      prev.setAttribute('aria-label', '上一条'); next.setAttribute('aria-label', '下一条');
      prev.disabled = pagerStep <= 0; next.disabled = pagerStep >= max;
      const position = pagerStep < items.length ? `${pagerStep + 1} / ${items.length}` : (hasEgg && pagerStep === items.length ? '彩蛋' : '完');
      pager.append(prev, el('span', 'pager-position', position), next);
      bar.append(pager);
    }
    return bar;
  }
  function movePager(delta) {
    const items = Array.isArray(issue?.items) ? issue.items : [];
    const hasEgg = Boolean(eggCard());
    pagerStep = Math.max(0, Math.min(items.length + (hasEgg ? 1 : 0), pagerStep + delta));
    render(); window.scrollTo(0, 0);
  }
  function briefStory(item, position, total) {
    const article = el('article', 'pager-story news-card is-open');
    article.dataset.id = item.id; article.dataset.section = item.section;
    const section = Object.hasOwn(sections, item.section) ? sections[item.section] : item.section || '';
    article.append(el('div', 'pager-section', `${section}${item.kind === 'update' ? ' · 进展' : ''}`));
    article.append(el('h2', 'pager-title', item.title || ''));
    const sources = Array.isArray(item.sources) ? item.sources : [];
    const sourceLine = el('div', 'sources');
    if (sources.length) {
      sourceLine.append(document.createTextNode('信源：'));
      sources.forEach((source, i) => {
        if (i) sourceLine.append(document.createTextNode(' · '));
        sourceLine.append(externalLink(source.name || '', source.url));
      });
      if (item.source_count != null) sourceLine.append(el('span', 'source-count', `（共 ${item.source_count} 家报道）`));
    }
    if (item.basis === 'summary' || item.basis === 'single') sourceLine.append(el('span', 'basis', item.basis === 'summary' ? '仅据摘要' : '单一信源'));
    const deep = deepSection(item);
    if (!deep) article.append(sourceLine);
    const body = el('div', 'card-body');
    paragraphs(body, item.gist, 'pager-lede');
    labeled(body, '核心事实', item.facts, 'pager-facts');
    labeled(body, '为什么重要', item.why);
    labeled(body, '后续看点', item.watch);
    if (item.takes?.length) {
      const takes = el('div', 'takes');
      takes.append(el('h4', 'block-label', '旁批'));
      item.takes.forEach(take => {
        const line = el('div', 'take');
        if (take.label) line.append(el('span', 'take-label', take.label));
        paragraphs(line, take.text); takes.append(line);
      });
      body.append(takes);
    }
    if (item.craft) {
      const craft = el('details', 'craft');
      craft.append(el('summary', '', '巧思拆解')); paragraphs(craft, item.craft); body.append(craft);
    }
    if (deep) body.append(deep, sourceLine);
    const actions = el('div', 'pager-actions');
    if (read.has(item.id)) {
      actions.append(el('span', 'pager-read', '已读'));
      actions.append(button('标为未读', 'pager-unmark', () => { read.delete(item.id); set(readKey(), JSON.stringify([...read])); render(); }));
    }
    actions.append(button(position === total - 1 ? '读完了 →' : '下一条 →', 'pager-primary', () => {
      read.add(item.id); set(readKey(), JSON.stringify([...read])); movePager(1);
    }));
    const back = button('‹ 上一条', 'pager-back', () => movePager(-1));
    back.disabled = position === 0;
    actions.append(back);
    body.append(actions); article.append(body);
    return article;
  }
  function briefDaily(main, items, count, subtitle) {
    const egg = eggCard();
    if (pagerStep === null) {
      const first = items.findIndex(item => !read.has(item.id));
      pagerStep = first < 0 ? items.length + (egg ? 1 : 0) : first;
    }
    const header = masthead(dateLabel(issue.date), subtitle, `${count} / ${items.length}`, issue.date, 'daily');
    header.append(pagerBar('今日简报', items, Boolean(egg)));
    main.append(header);
    if (!issue.mock && !location.hash && issue.date < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) {
      main.append(el('p', 'stale-note', `今天的简报还没到，或当前离线。这是 ${dateParts(issue.date)?.md || issue.date} 的。`));
    }
    if (pagerStep < items.length) main.append(briefStory(items[pagerStep], pagerStep, items.length));
    else if (egg && pagerStep === items.length) {
      main.append(egg, button('继续 →', 'pager-primary pager-continue', () => movePager(1)));
    } else main.append(endBlock(false, items.length, count));
    document.querySelector('.progress-line span').style.width = `${items.length ? count / items.length * 100 : 0}%`;
    document.querySelector('.progress-line').hidden = false;
  }
  function daily(main) {
    const items = Array.isArray(issue.items) ? issue.items : [];
    const count = items.filter(item => read.has(item.id)).length;
    const subtitle = [`${items.length} 条`, issue.read_minutes != null ? `约 ${issue.read_minutes} 分钟` : ''].filter(Boolean).join(' · ');
    if (root.dataset.theme === 'brief') { briefDaily(main, items, count, subtitle); return; }
    const header = masthead(dateLabel(issue.date), subtitle, `${count} / ${items.length}`, issue.date, 'daily');
    const segments = el('div', 'segments');
    segments.setAttribute('aria-hidden', 'true');
    items.forEach(item => segments.append(el('span', read.has(item.id) ? 'filled' : '')));
    header.append(segments);
    main.append(header);
    if (!issue.mock && !location.hash && issue.date < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) {
      main.append(el('p', 'stale-note', `今天的简报还没到，或当前离线。这是 ${dateParts(issue.date)?.md || issue.date} 的。`));
    }
    const keys = [...Object.keys(sections), ...new Set(items.map(item => item.section).filter(key => !Object.hasOwn(sections, key)))];
    let target = main;
    if (root.dataset.theme === 'glance') {
      const layout = el('div', 'glance-layout');
      target = el('div', 'glance-stories');
      layout.append(glanceList(items), target); main.append(layout);
    } else if (root.dataset.theme === 'review') {
      target = el('div', 'review-grid');
      main.append(target);
    }
    const groups = root.dataset.theme === 'review' ? items.reduce((result, item) => {
      let group = result[result.length - 1];
      if (!group || group.key !== item.section) {
        group = { key: item.section, groupItems: [] };
        result.push(group);
      }
      group.groupItems.push(item);
      return result;
    }, []) : keys.map(key => ({ key, groupItems: items.filter(item => item.section === key) }));
    let cardNumber = 0;
    let firstSection = true;
    groups.forEach(({ key, groupItems }) => {
      if (!groupItems.length) return;
      const group = el('section', 'news-section');
      group.dataset.section = key;
      if (root.dataset.theme === 'duan') group.id = `section-${key}`;
      const label = el('h2', 'section-label');
      const code = el('span', 'section-code', String(key || '').toUpperCase());
      code.setAttribute('aria-hidden', 'true');
      label.append(code, document.createTextNode(Object.hasOwn(sections, key) ? sections[key] : key || ''));
      group.append(label);
      groupItems.forEach(item => group.append(card(item, ++cardNumber)));
      if (firstSection && groupItems.length % 2 === 0) {
        const directory = el('aside', 'front-page-index');
        directory.append(el('h3', '', '本期目录'));
        const rows = el('div', 'front-page-sections');
        keys.forEach(section => {
          const amount = items.filter(item => item.section === section).length;
          if (!amount) return;
          const row = el('div', 'front-page-row');
          row.append(el('span', '', Object.hasOwn(sections, section) ? sections[section] : section || ''),
            el('span', '', `${amount} 条`));
          rows.append(row);
        });
        directory.append(rows);
        group.append(directory);
      }
      firstSection = false;
      target.append(group);
    });
    if (root.dataset.theme === 'review') {
      layoutReviewGrid(target);
      main.append(reviewIndex(items));
    }
    const egg = eggCard();
    if (egg) main.append(egg);
    main.append(endBlock(false, items.length, count));
    document.querySelector('.progress-line span').style.width = `${items.length ? count / items.length * 100 : 0}%`;
    document.querySelector('.progress-line').hidden = false;
  }
  function weekly(main) {
    const range = issue.week?.from && issue.week?.to ? `${dateParts(issue.week.from)?.md || issue.week.from} – ${dateParts(issue.week.to)?.md || issue.week.to}` : '';
    const header = masthead('周日慢读', [dateLabel(issue.date), range].filter(Boolean).join(' · '), null, issue.date, 'weekly');
    if (root.dataset.theme === 'brief') header.append(pagerBar('周日慢读', [], false, true));
    main.append(header);
    const review = issue.review || {};
    if (review.title || review.threads?.length) {
    const part = el('section', 'weekly-review');
    part.append(el('h2', 'section-label', '本周复盘'));
    if (review.title) part.append(el('h1', 'essay-title', review.title));
    paragraphs(part, review.lede, 'lede');
    (review.threads || []).forEach(thread => {
      const block = el('article', 'thread');
      block.append(el('h2', '', thread.title || ''));
      paragraphs(block, thread.body);
      if (Array.isArray(thread.refs) && thread.refs.length) {
        const refs = el('div', 'refs');
        refs.append(document.createTextNode('相关：'));
        thread.refs.forEach((ref, i) => {
          if (i) refs.append(document.createTextNode(' · '));
          const label = `${dateParts(ref.date)?.weekday || ref.date || ''} · ${ref.title || ''}`;
          refs.append(index.some(entry => entry.date === ref.date) ? internalLink(label, `#/${ref.date}`) : el('span', '', label));
        });
        block.append(refs);
      }
      part.append(block);
    });
    labeled(part, '下周看点', review.closing, 'closing');
    main.append(part);
    }
    const longreads = el('section', 'longreads');
    longreads.append(el('h2', 'section-label', '长文导读'));
    if (!issue.longreads?.length) longreads.append(el('p', 'empty-longreads', '本周没有够格的长文。宁缺毋滥。'));
    (issue.longreads || []).forEach(item => {
      const article = el('article', 'longread');
      if (item.tags?.length) article.append(el('div', 'tags', item.tags.join(' · ')));
      article.append(el('h2', 'longread-title', item.title || ''));
      if (item.original_title) article.append(el('p', 'original-title', item.original_title));
      const published = dateParts(item.published)?.md || item.published;
      const meta = [item.source, item.author, published, item.minutes != null ? `约 ${item.minutes} 分钟` : '', ({ en: '英文', zh: '中文' })[item.lang]].filter(Boolean).join(' · ');
      if (meta) article.append(el('p', 'longread-meta', meta));
      paragraphs(article, item.pitch, 'pitch');
      paragraphs(article, item.summary);
      [['论证脉络', item.argument, 'ol'], ['带着读', item.questions, 'ul']].forEach(([label, values, tag]) => {
        if (!Array.isArray(values) || !values.length) return;
        const block = el('div', 'text-block');
        block.append(el('h3', 'block-label', label));
        const list = el(tag);
        values.forEach(value => list.append(el('li', '', value)));
        block.append(list);
        article.append(block);
      });
      labeled(article, '可以质疑', item.caveat);
      if (item.url) article.append(externalLink('读原文 ↗', item.url, 'original-link'));
      longreads.append(article);
    });
    main.append(longreads, endBlock(true));
    document.querySelector('.progress-line').hidden = true;
  }
  let settingsWasOpen = false, olderWasOpen = false;
  function render() {
    settingsWasOpen = app.querySelector('.settings')?.open || false;
    olderWasOpen = app.querySelector('.older-themes')?.open || false;
    app.replaceChildren();
    if (issue?.mock) app.append(el('div', 'mock-banner', `示例数据${issue.mock_note ? ` · ${issue.mock_note}` : ''}`));
    const main = el('main', 'column');
    app.append(main);
    if (location.hash === '#/archive') {
      document.querySelector('.progress-line').hidden = true;
      const header = masthead('往期', '最近的简报');
      main.append(header);
      const list = el('div', 'archive-list');
      index.slice(0, 60).forEach(entry => {
        const suffix = entry.type === 'weekly' ? `周日慢读${entry.title ? ` · ${entry.title}` : ''}` : `${entry.count ?? 0} 条`;
        list.append(internalLink(`${dateLabel(entry.date)} · ${suffix}`, `#/${entry.date}`, 'archive-entry'));
      });
      main.append(list, internalLink('← 返回最新一期', '#', 'back-link'));
    } else if (!issue) {
      document.querySelector('.progress-line').hidden = true;
      main.append(masthead('简报', ''), el('p', 'empty-message', '没有这一期'), internalLink('← 返回最新一期', '#', 'back-link'));
    } else if (issue.type === 'weekly') weekly(main);
    else daily(main);
  }
  async function fetchJSON(path, options) {
    const response = await fetch(path, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  async function loadIndex() {
    async function from(dir) {
      const data = await fetchJSON(`${dir}/index.json`, { cache: 'no-cache' });
      if (!Array.isArray(data.issues) || !data.issues.length || !data.issues.every(entry => dateParts(entry.date) && ['daily', 'weekly'].includes(entry.type))) throw new Error('Invalid index');
      return data.issues.sort((a, b) => b.date.localeCompare(a.date));
    }
    try { index = await from(base); }
    catch {
      if (base === 'mock') throw new Error('No index');
      base = 'mock';
      index = await from(base);
    }
  }
  async function route() {
    const version = ++routeVersion;
    openId = null;
    pagerStep = null;
    const hash = location.hash;
    if (hash === '#/archive') {
      issue = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    const date = !hash || hash === '#' ? index[0]?.date : /^#\/(\d{4}-\d{2}-\d{2})$/.exec(hash)?.[1];
    if (!index.some(entry => entry.date === date)) {
      issue = null;
      render();
      window.scrollTo(0, 0);
      return;
    }
    try {
      const loaded = await fetchJSON(`${base}/${date}.json`);
      if (version !== routeVersion) return;
      issue = loaded;
      read = loadRead();
      render();
      const items = issue.type === 'daily' ? (issue.items || []) : [];
      const count = items.filter(item => read.has(item.id)).length;
      if (root.dataset.theme !== 'brief' && count > 0 && count < items.length) requestAnimationFrame(() => app.querySelector('.news-card:not(.is-read)')?.scrollIntoView({ block: 'start' }));
      else window.scrollTo(0, 0);
    } catch {
      if (version !== routeVersion) return;
      issue = null;
      render();
    }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const settings = app.querySelector('.settings[open]');
      if (settings) {
        settings.open = false;
        settings.querySelector('summary').focus();
        event.preventDefault();
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable], .settings')) return;
    if (root.dataset.theme === 'brief' && issue?.type === 'daily') {
      if (['ArrowLeft', 'ArrowRight', 'j', 'k'].includes(event.key)) {
        event.preventDefault(); movePager(['ArrowRight', 'j'].includes(event.key) ? 1 : -1);
      } else if (event.key === 'x' && pagerStep < (issue.items || []).length) {
        event.preventDefault();
        const id = issue.items[pagerStep].id;
        if (read.has(id)) read.delete(id); else read.add(id);
        set(readKey(), JSON.stringify([...read])); render();
      }
      return;
    }
    if (!['j', 'k', 'x'].includes(event.key) || issue?.type !== 'daily') return;
    const cards = [...app.querySelectorAll('.card-header')];
    const current = cards.indexOf(document.activeElement);
    if (event.key === 'x' && current >= 0) {
      event.preventDefault();
      const item = cards[current].closest('.news-card');
      updateRead(item.dataset.id, !read.has(item.dataset.id));
      app.querySelectorAll('.card-header')[current]?.focus({ preventScroll: true });
    } else if (event.key !== 'x' && cards.length) {
      event.preventDefault();
      const next = current < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, current + (event.key === 'j' ? 1 : -1)));
      cards[next].focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.settings')) {
      const settings = app.querySelector('.settings[open]');
      if (settings) settings.open = false;
    }
  });
  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);
  cleanRead();
  applySettings();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && params.get('sw') === '1'))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  loadIndex().then(route).catch(() => {
    app.replaceChildren(el('p', 'loading', '暂时无法打开简报，请稍后再试。'));
  });
})();
