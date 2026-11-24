/*
 * SkillShadow - Career Assessments
 * Works with career-assessment.html and the FastAPI /api/career-assessments routes.
 * Answers are scored by the backend. No student results are saved.
 */
(() => {
  'use strict';

  const get = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const requestedCareer = params.get('career') || '';
  const requestedModule = params.get('module') || '';
  const requestedTopic = params.get('topic') || '';

  const state = {
    careers: [],
    topics: [],
    careerSlug: '',
    topicId: '',
    questions: []
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => {
      const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      };
      return entities[character];
    });
  }

  function showError(message) {
    get('error').textContent = String(message);
    get('error').hidden = false;
  }

  function clearError() {
    get('error').textContent = '';
    get('error').hidden = true;
  }

  async function requestJson(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (_error) {
      throw new Error('Could not connect to SkillShadow. Check your connection or API deployment.');
    }

    if (!response.ok) {
      let message = `Request failed (HTTP ${response.status}).`;
      try {
        const body = await response.json();
        if (typeof body.detail === 'string') message = body.detail;
      } catch (_error) {
        // An HTML error page or empty response is also possible.
      }
      throw new Error(message);
    }

    try {
      return await response.json();
    } catch (_error) {
      throw new Error('The server did not return valid JSON. Check the API route.');
    }
  }

  function normalize(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function findCareer(nameOrSlug) {
    const wanted = normalize(nameOrSlug);
    return state.careers.find((career) => {
      return normalize(career.slug) === wanted ||
        normalize(career.title) === wanted ||
        (Array.isArray(career.aliases) && career.aliases.some((alias) => normalize(alias) === wanted));
    });
  }

  function topicsFor(career) {
    if (!career || !Array.isArray(career.moduleIds)) return [];
    return state.topics.filter((topic) => career.moduleIds.includes(topic.module_id));
  }

  function setScreen(which) {
    get('select-panel').hidden = which !== 'select';
    get('quiz-panel').hidden = which !== 'quiz';
    get('result-panel').hidden = which !== 'result';
    clearError();
  }

  function renderSubjects() {
    const career = findCareer(state.careerSlug);
    const topics = topicsFor(career);

    get('available-topics').innerHTML = topics.map((topic) => `
      <button type="button" class="topic" data-topic="${escapeHtml(topic.id)}">
        <strong>${escapeHtml(topic.title)}</strong>
        <small>${escapeHtml(topic.description)}</small>
        <span class="pill">${Number(topic.question_count) || 0} questions · Start →</span>
      </button>
    `).join('');

    if (!career) {
      get('selection-note').textContent = 'Choose a career to view its available subject tests.';
    } else if (topics.length === 0) {
      get('selection-note').textContent = 'No subject tests are available for this career yet. Its roadmap is still available.';
    } else {
      get('selection-note').textContent = `${topics.length} practice assessment${topics.length === 1 ? '' : 's'} available for ${career.title}. More subjects are being developed.`;
    }

    get('roadmap-link').href = career
      ? `/roadmap.html?career=${encodeURIComponent(career.slug)}`
      : '/roadmap.html';
  }

  async function startAssessment(topicId) {
    const career = findCareer(state.careerSlug);
    if (!topicsFor(career).some((topic) => topic.id === topicId)) {
      showError('Choose a subject available for your selected career.');
      return;
    }

    clearError();
    try {
      const data = await requestJson(`/api/career-assessments/questions/${encodeURIComponent(topicId)}`);
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('This assessment does not have any questions yet.');
      }

      state.topicId = topicId;
      state.questions = data.questions;
      get('quiz-title').textContent = data.title;
      get('quiz-subtitle').textContent = `${career.title} · ${data.questions.length} questions · Answer every question before submitting`;

      get('question-list').innerHTML = data.questions.map((question, questionIndex) => {
        const choices = question.options.map((choice, choiceIndex) => `
          <label class="option">
            <input type="radio" name="question-${question.id}" value="${choiceIndex}">
            <span><b>${String.fromCharCode(65 + choiceIndex)}.</b> ${escapeHtml(choice)}</span>
          </label>
        `).join('');
        return `
          <fieldset class="question">
            <legend class="question-number">QUESTION ${questionIndex + 1} OF ${data.questions.length}</legend>
            <h3>${escapeHtml(question.question)}</h3>
            ${choices}
          </fieldset>
        `;
      }).join('');

      setScreen('quiz');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showError(error.message || 'Could not load this assessment.');
    }
  }

  async function submitAssessment(event) {
    event.preventDefault();
    clearError();

    const answers = {};
    for (const question of state.questions) {
      const selected = document.querySelector(`input[name="question-${question.id}"]:checked`);
      if (!selected) {
        showError(`Please answer question ${question.id} before submitting.`);
        return;
      }
      answers[question.id] = Number(selected.value);
    }

    const submitButton = get('submit-btn');
    submitButton.disabled = true;
    try {
      const results = await requestJson('/api/career-assessments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic_id: state.topicId, answers })
      });

      get('result-score').textContent = `${results.score_percent}%`;
      get('result-summary').textContent = `You answered ${results.correct} of ${results.total} questions correctly. Review the explanations and revisit unfamiliar concepts in your roadmap.`;
      get('review-list').innerHTML = results.review.map((item, index) => `
        <article class="review">
          <span class="${item.is_correct ? 'correct' : 'incorrect'}">
            ${item.is_correct ? '✓ Correct' : '✗ Review this topic'}
          </span>
          <h3>${index + 1}. ${escapeHtml(item.question)}</h3>
          <p><strong>Correct answer:</strong> ${escapeHtml(item.correct_answer)}</p>
          <p class="muted">${escapeHtml(item.explanation)}</p>
        </article>
      `).join('');

      setScreen('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showError(error.message || 'Could not submit this assessment.');
    } finally {
      submitButton.disabled = false;
    }
  }

  async function initialize() {
    get('career-select').addEventListener('change', (event) => {
      state.careerSlug = event.target.value;
      renderSubjects();
      clearError();
    });

    get('available-topics').addEventListener('click', (event) => {
      const button = event.target.closest('[data-topic]');
      if (button) void startAssessment(button.dataset.topic);
    });

    get('quiz-form').addEventListener('submit', submitAssessment);
    get('cancel-btn').addEventListener('click', () => setScreen('select'));
    get('other-btn').addEventListener('click', () => setScreen('select'));
    get('retry-btn').addEventListener('click', () => void startAssessment(state.topicId));

    try {
      const [library, topics] = await Promise.all([
        requestJson('/career-roadmaps/roadmaps.json'),
        requestJson('/api/career-assessments/topics')
      ]);
      if (!Array.isArray(library.careers) || !Array.isArray(topics)) {
        throw new Error('The career roadmap or assessment catalog format is not valid.');
      }

      state.topics = topics;
      state.careers = library.careers
        .filter((career) => topicsFor(career).length > 0)
        .sort((a, b) => a.title.localeCompare(b.title));

      get('career-select').innerHTML = '<option value="">Choose a career</option>' +
        state.careers.map((career) => `<option value="${escapeHtml(career.slug)}">${escapeHtml(career.title)}</option>`).join('');

      const chosenCareer = findCareer(requestedCareer);
      state.careerSlug = chosenCareer ? chosenCareer.slug : '';
      get('career-select').value = state.careerSlug;
      renderSubjects();

      if (chosenCareer) {
        const subjects = topicsFor(chosenCareer);
        const requested = subjects.find((topic) => topic.id === requestedTopic) ||
          subjects.find((topic) => topic.module_id === requestedModule);
        if (requested) await startAssessment(requested.id);
      }
    } catch (error) {
      showError(error.message || 'Could not load the assessment catalog.');
      get('selection-note').textContent = 'The assessment service is not available right now.';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    void initialize();
  }
})();
