/* SkillShadow Career Roadmaps — no third-party JS dependencies.
   Data source: /career-roadmaps/roadmaps.json.
   Progress is stored locally PER CAREER, not in the SkillShadow backend. */
(() => {
  'use strict';
  const dataUrl = '/career-roadmaps/roadmaps.json';
  const storagePrefix = 'skillshadow_roadmap_progress_v1:';
  const assessedModules = new Set(['python','sql','india-cse-prelims','india-medical-mbbs']);
  const $ = (id) => document.getElementById(id);
  const state = { data: null, selected: null, category: 'all', query: '', expanded: new Set(), progress: new Set() };
  const escapeHTML = (str) => String(str ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clean = s => String(s || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const flatWords = s => clean(s).split(' ').filter(Boolean);
  const labels = c => [c.title, ...(c.aliases || []), c.category, c.slug.replace(/-/g, ' ')].map(clean);

  function getCareerBySlug(slug) { return state.data?.careers.find(c => c.slug === slug) || null; }
  function progressKey(slug) { return storagePrefix + slug; }
  function readProgress(slug) {
    try { const data = JSON.parse(localStorage.getItem(progressKey(slug)) || '[]'); return new Set(Array.isArray(data) ? data.filter(v => typeof v === 'string') : []); }
    catch { return new Set(); }
  }
  function saveProgress() {
    if (!state.selected) return;
    try { localStorage.setItem(progressKey(state.selected.slug), JSON.stringify([...state.progress])); }
    catch { /* Browser privacy settings can disable storage; keep session progress. */ }
  }
  function topicKey(moduleId, index) { return `${moduleId}:${index}`; }
  function careerTopics(c) {
    return c.moduleIds.flatMap(id => (state.data.modules[id]?.topics || []).map((_, i) => topicKey(id, i)));
  }
  function scoreCareer(c, q) {
    if (!q) return 1;
    const exact = clean(q);
    const all = labels(c);
    if (all.some(v => v === exact)) return 100;
    if (all.some(v => v.startsWith(exact))) return 70;
    if (all.some(v => v.includes(exact))) return 50;
    const words = flatWords(q);
    if (words.length && words.every(w => all.some(v => v.split(' ').some(t => t.startsWith(w))))) return 20;
    return 0;
  }
  function matches() {
    return state.data.careers.filter(c => (state.category === 'all' || c.category === state.category) && scoreCareer(c, state.query) > 0)
      .sort((a,b) => scoreCareer(b, state.query) - scoreCareer(a, state.query) || a.title.localeCompare(b.title));
  }
  function updateURL(c) {
    const url = new URL(window.location.href);
    if (c) url.searchParams.set('career', c.slug);
    else url.searchParams.delete('career');
    history.replaceState(null, '', url);
  }
  function showOnly(id) {
    ['empty-view','loading-view','error-view','roadmap-view'].forEach(v => $(v).hidden = v !== id);
  }
  function renderCatalog() {
    if (!state.data) return;
    const found = matches();
    $('result-count').textContent = String(found.length);
    $('filter-summary').textContent = state.query ? `Search: “${state.query}”` : (state.category === 'all' ? 'All careers' : state.category);
    $('career-list').innerHTML = found.length ? found.map(c => {
      const isSelected = state.selected?.slug === c.slug;
      return `<button type="button" class="career-choice" data-career="${escapeHTML(c.slug)}" aria-current="${isSelected}" aria-label="Open roadmap for ${escapeHTML(c.title)}"><span><strong>${escapeHTML(c.title)}</strong><small>${escapeHTML(c.category)}</small></span><span class="choice-arrow" aria-hidden="true">›</span></button>`;
    }).join('') : '<div class="sidebar-footer">No matching career in this catalog. Try another title or browse all fields.</div>';
  }
  function refreshProgress() {
    if (!state.selected) return;
    const c = state.selected;
    const all = careerTopics(c);
    const done = all.filter(k => state.progress.has(k)).length;
    const percentage = all.length ? Math.round(100*done/all.length) : 0;
    $('progress-label').textContent = `${percentage}% · ${done}/${all.length} topics`;
    $('progress-fill').style.width = `${percentage}%`;
    $('progress-bar').setAttribute('aria-valuenow',String(percentage));
    c.moduleIds.forEach((id, stageIndex) => {
      const mod = state.data.modules[id];
      const complete = mod.topics.filter((_,i) => state.progress.has(topicKey(id,i))).length;
      const stage = document.querySelector(`[data-stage="${stageIndex}"]`);
      if (!stage) return;
      stage.classList.toggle('done',complete === mod.topics.length);
      stage.querySelector('.stage-progress').textContent = `${complete}/${mod.topics.length} done`;
    });
  }
  function renderRoadmap() {
    const c = state.selected;
    if (!c) { showOnly('empty-view'); return; }
    const mods = c.moduleIds.map(id => state.data.modules[id]);
    $('path-category').textContent = c.category;
    $('path-title').textContent = c.title;
    $('path-summary').textContent = c.summary;
    $('path-note').hidden = !c.note;
    $('path-note').textContent = c.note || '';
    $('metric-weeks').textContent = `${mods.reduce((sum,m) => sum + m.weeks,0)}+`;
    $('metric-stages').textContent = String(mods.length);
    $('metric-topics').textContent = String(mods.reduce((sum,m) => sum + m.topics.length,0));
    $('stage-count').textContent = `${mods.length} stages · ordered by learning progression`;
    $('capstone-list').innerHTML = c.capstones.map(p => `<li>${escapeHTML(p)}</li>`).join('');
    $('stage-list').innerHTML = mods.map((mod,index) => {
      const open = state.expanded.has(index);
      const header = `${index+1}`.padStart(2,'0');
      return `<article class="stage-row" data-stage="${index}">
        <div class="stage-no" aria-hidden="true">${header}</div>
        <section class="stage-card ${open ? 'open' : ''}">
          <button class="stage-head" type="button" data-toggle-stage="${index}" aria-expanded="${open}" aria-controls="stage-content-${index}">
            <span class="stage-head-text"><strong>${escapeHTML(mod.title)}</strong><small>Stage ${header} · Approx. ${mod.weeks} ${mod.weeks === 1 ? 'week':'weeks'} · ${mod.topics.length} topic groups</small></span>
            <span class="stage-head-tools"><span class="stage-progress">0/${mod.topics.length} done</span><span class="stage-chevron" aria-hidden="true">⌄</span></span>
          </button>
          <div class="stage-body" id="stage-content-${index}" ${open ? '' : 'hidden'}>
            <p class="module-overview">${escapeHTML(mod.overview)}</p>
            <div class="topic-list">${mod.topics.map((t,i) => {
              const key = topicKey(mod.id,i), done = state.progress.has(key);
              return `<label class="topic-row ${done ? 'checked' : ''}"><input type="checkbox" data-topic="${escapeHTML(key)}" ${done?'checked':''}/><span class="topic-content"><span class="topic-name">${escapeHTML(t.title)}</span>${t.details.length ? `<span class="topic-details">${t.details.map(escapeHTML).join(' · ')}</span>`:''}</span></label>`;
            }).join('')}</div>
            <div class="practice-box"><span class="practice-symbol" aria-hidden="true">✧</span><div><strong>HANDS-ON PRACTICE</strong><p>${escapeHTML(mod.practice)}</p></div></div>
            ${assessedModules.has(mod.id) ? `<p style="margin:16px 0 2px"><a class="action-button action-primary" href="/career-assessment.html?career=${encodeURIComponent(c.slug)}&module=${encodeURIComponent(mod.id)}">Take subject assessment ↗</a></p>` : ''}
          </div>
        </section></article>`;
    }).join('');
    refreshProgress();
    $('expand-all').innerHTML = state.expanded.size === mods.length ? 'Collapse all stages <span>↑</span>' : 'Expand all stages <span>↓</span>';
    showOnly('roadmap-view');
  }
  function choose(c, scroll = true) {
    if (!c) return;
    state.selected = c;
    state.progress = readProgress(c.slug);
    state.expanded = new Set([0]);
    updateURL(c); renderCatalog(); renderRoadmap();
    if (scroll && window.innerWidth < 801) $('details').scrollIntoView({ behavior: 'smooth', block:'start' });
  }
  function syncStage(index) {
    const row = document.querySelector(`[data-stage="${index}"]`);
    if (!row) return;
    const open = state.expanded.has(index);
    const header = row.querySelector('.stage-head');
    const body = row.querySelector('.stage-body');
    header.setAttribute('aria-expanded',String(open));
    body.hidden = !open;
    row.querySelector('.stage-card').classList.toggle('open',open);
  }
  function handleClick(e) {
    const choice = e.target.closest('[data-career]');
    if (choice) { choose(getCareerBySlug(choice.dataset.career)); return; }
    const stageToggle = e.target.closest('[data-toggle-stage]');
    if (stageToggle) {
      const index = Number(stageToggle.dataset.toggleStage);
      if (state.expanded.has(index)) state.expanded.delete(index); else state.expanded.add(index);
      syncStage(index);
      $('expand-all').innerHTML = state.expanded.size === state.selected.moduleIds.length ? 'Collapse all stages <span>↑</span>' : 'Expand all stages <span>↓</span>';
    }
  }
  function handleChange(e) {
    const input = e.target.closest('[data-topic]');
    if (!input) return;
    if (input.checked) state.progress.add(input.dataset.topic); else state.progress.delete(input.dataset.topic);
    input.closest('.topic-row').classList.toggle('checked',input.checked);
    saveProgress();refreshProgress();
  }
  function expandAll() {
    if (!state.selected) return;
    const allOpen = state.expanded.size === state.selected.moduleIds.length;
    state.expanded = allOpen ? new Set() : new Set(state.selected.moduleIds.map((_,i)=>i));
    state.selected.moduleIds.forEach((_,i)=>syncStage(i));
    $('expand-all').innerHTML = allOpen ? 'Expand all stages <span>↓</span>' : 'Collapse all stages <span>↑</span>';
  }
  function printRoadmap() {
    if (!state.selected) return;
    const previous = new Set(state.expanded);
    state.expanded = new Set(state.selected.moduleIds.map((_,i)=>i));
    state.selected.moduleIds.forEach((_,i)=>syncStage(i));
    const restore = () => { window.removeEventListener('afterprint',restore);state.expanded=previous;state.selected.moduleIds.forEach((_,i)=>syncStage(i)); };
    window.addEventListener('afterprint',restore,{once:true});
    window.print();
  }
  function handleUrlPrefill() {
    const requested = new URLSearchParams(location.search).get('career');
    if (!requested) return;
    const normalized = clean(requested);
    const exact = state.data.careers.find(c => c.slug === requested || labels(c).some(label => label === normalized));
    if (exact) choose(exact,false);
    else {
      state.query = requested;$('career-search').value = requested;
      const ranked = matches();
      if (ranked.length === 1) choose(ranked[0],false);
      else renderCatalog();
    }
  }
  async function init() {
    showOnly('loading-view');
    $('career-search').addEventListener('input',e => { state.query = e.target.value.trim(); renderCatalog(); });
    $('career-search').addEventListener('keydown',e => { if (e.key==='Enter') { const found=matches(); if(found.length) choose(found[0]); } });
    $('category-filter').addEventListener('change',e => {state.category=e.target.value;renderCatalog();});
    $('clear-filters').addEventListener('click',()=>{state.query='';state.category='all';$('career-search').value='';$('category-filter').value='all';renderCatalog();});
    $('career-list').addEventListener('click',handleClick);
    $('stage-list').addEventListener('click',handleClick);
    $('stage-list').addEventListener('change',handleChange);
    $('expand-all').addEventListener('click',expandAll);
    $('print-path').addEventListener('click',printRoadmap);
    $('reset-progress').addEventListener('click',()=>{
      if (!state.selected || !window.confirm(`Reset all checklist progress for ${state.selected.title}?`)) return;
      state.progress.clear();saveProgress();renderRoadmap();
    });
    try {
      const res=await fetch(dataUrl,{cache:'no-cache'});
      if (!res.ok) throw new Error(`Data request returned HTTP ${res.status}.`);
      const data=await res.json();
      if (!data || !Array.isArray(data.careers) || !data.modules || typeof data.modules !== 'object') throw new Error('Roadmap data is not in the expected format.');
      for (const career of data.careers) for (const id of career.moduleIds) if (!data.modules[id]) throw new Error(`Missing module “${id}” for ${career.title}.`);
      state.data=data;
      $('stat-careers').textContent=String(data.careers.length);
      $('stat-modules').textContent=String(Object.keys(data.modules).length);
      $('stat-topics').textContent=String(Object.values(data.modules).reduce((n,m)=>n+m.topics.length,0));
      $('category-filter').innerHTML='<option value="all">All career fields</option>'+data.categories.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
      renderCatalog(); showOnly('empty-view'); handleUrlPrefill();
    } catch(e) {
      $('error-message').textContent=`${e.message} Make sure frontend/public/roadmap.html and frontend/public/career-roadmaps/roadmaps.json are present, then run npm run dev from your frontend folder.`;
      showOnly('error-view');
    }
  }
  document.addEventListener('DOMContentLoaded',init);
})();
