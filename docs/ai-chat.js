// --- KI CHAT WIDGET LOGIK (Shared) ---
export function initChat(WORKER_URL, filterEventsFn, stateObj) {
  const aiWindow = document.getElementById('aiWindow');
  const chatToggleBtn = document.getElementById('aiToggleButton');
  const chatCloseBtn = document.getElementById('aiCloseButton');
  const aiForm = document.getElementById('aiForm');
  const aiInput = document.getElementById('aiInput');
  const aiMessages = document.getElementById('aiMessages');
  const aiSubmit = document.getElementById('aiSubmit');

  if (!aiWindow) return; // Prevent errors if HTML is missing

  let chatHistory = [];

  aiInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });

  aiInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      aiForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  chatToggleBtn.addEventListener('click', () => {
    aiWindow.classList.toggle('open');
    if (aiWindow.classList.contains('open')) aiInput.focus();
  });

  chatCloseBtn.addEventListener('click', () => {
    aiWindow.classList.remove('open');
  });

  function appendMessage(text, role) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `ai-msg ${role === "bot" ? "ai" : role}`;
    if (role === 'bot' && typeof marked !== 'undefined') {
      msgDiv.innerHTML = marked.parse(text);
    } else {
      msgDiv.textContent = text;
    }
    aiMessages.appendChild(msgDiv);
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }

  aiForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = aiInput.value.trim();
    if (!text) return;
    
    appendMessage(text, "user");
    aiInput.value = "";
    aiInput.style.height = 'auto';
    aiInput.disabled = true;
    aiSubmit.disabled = true;
    
    chatHistory.push({ role: "user", parts: [{ text }] });

    const loadingDiv = document.createElement('div');
    loadingDiv.className = "ai-msg ai";
    loadingDiv.textContent = "Denkt nach...";
    loadingDiv.id = "aiLoading";
    aiMessages.appendChild(loadingDiv);
    aiMessages.scrollTop = aiMessages.scrollHeight;

    try {
      // Wir filtern die Events, damit das JSON nicht zu groß wird
      const relevantEvents = filterEventsFn(stateObj.events) || stateObj.events;
      const shortEvents = relevantEvents.map(ev => ({
        title: ev.title,
        start: ev.start,
        end: ev.end,
        wochentag: ev.extendedProps?.wochentag,
        buchung: ev.extendedProps?.bookingStatus,
        preis: ev.extendedProps?.price,
        kategorie: ev.extendedProps?.kategorie || 'Sonstige',
        url: ev.url
      }));

      const todayStr = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full' }).format(new Date());
      const payloadHistory = [
        { role: "user", parts: [{ text: `Wichtige Info für dich: Das heutige Datum ist ${todayStr}. Wenn der Nutzer nach "heute" oder bestimmten Wochentagen fragt, beziehe dich exakt auf dieses Datum.` }] },
        { role: "model", parts: [{ text: "Verstanden, ich werde dieses Datum für alle meine Antworten berücksichtigen." }] },
        ...chatHistory
      ];

      const response = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: payloadHistory,
          eventsData: shortEvents
        })
      });

      const data = await response.json();
      
      if (document.getElementById("aiLoading")) {
        document.getElementById("aiLoading").remove();
      }

      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const gResult = data.candidates[0].content.parts[0].text;
        appendMessage(gResult, "bot");
        chatHistory.push({ role: "model", parts: [{ text: gResult }] });
      } else if (data.error && data.error.message) {
        appendMessage(`API Fehler: ${data.error.message}`, "bot");
      } else {
        appendMessage("Sorry, ich konnte das nicht beantworten.", "bot");
      }

    } catch (error) {
      if (document.getElementById("aiLoading")) {
        document.getElementById("aiLoading").remove();
      }
      appendMessage("Verbindungsfehler...", "bot");
    }

    aiInput.disabled = false;
    aiSubmit.disabled = false;
    aiInput.focus();
  });
}
