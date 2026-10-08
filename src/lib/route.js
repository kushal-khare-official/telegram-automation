// Router decision: which brain gets the message, given the validated route and the open session.
// Mirrors "Session steps, exactly" in the brief. Pure, no I/O.

const ROUTE_TO_BRAIN = {
  daily_numbers: 'numbers',
  business_question: 'coach',
  wellbeing: 'care',
  menu_help: 'help',
};

// Inline button callback_data → {brain, action}. Only used when no session decides otherwise.
const BUTTON_ACTIONS = {
  record: { brain: 'numbers', action: 'start' },
  ask: { brain: 'help', action: 'ask' },
  today: { brain: 'help', action: 'today' },
  how: { brain: 'help', action: 'how' },
};

function commandOf(text) {
  const m = String(text || '').trim().toLowerCase().match(/^\/([a-z_]+)/);
  return m ? m[1] : null;
}

// Returns {brain, action, session_for_brain, close_session}
//  - session_for_brain: the session the brain should see (null when it was just closed)
//  - close_session: the open session must be deleted unless the brain opens a new one
function decideRoute({ route, session, text, callback_data }) {
  const open = session && session.active_brain ? session : null;
  const cmd = commandOf(text);
  const button = callback_data && BUTTON_ACTIONS[callback_data] ? BUTTON_ACTIONS[callback_data] : null;

  // 1. Distress always wins. Any non-Care session closes unsaved.
  if (route === 'wellbeing') {
    const careOpen = open && open.active_brain === 'care';
    return { brain: 'care', action: careOpen ? 'checkin' : 'open', session_for_brain: careOpen ? open : null, close_session: !!open && !careOpen };
  }

  // 2. Care session: only business intent leaves it; everything else gets a gentle check-in.
  if (open && open.active_brain === 'care') {
    if (route === 'daily_numbers' || route === 'business_question') {
      const fresh = freshDecision(route, cmd, button);
      return { ...fresh, session_for_brain: null, close_session: true };
    }
    return { brain: 'care', action: 'checkin', session_for_brain: open, close_session: false };
  }

  // 3. Numbers session owns the chat until done; menu_help (e.g. /help) cancels it unsaved.
  if (open && open.active_brain === 'numbers') {
    if (route === 'menu_help') {
      const action = button && button.brain === 'help' ? button.action : 'menu';
      return { brain: 'help', action, session_for_brain: null, close_session: true };
    }
    if (cmd === 'undo') return { brain: 'numbers', action: 'undo', session_for_brain: null, close_session: true };
    return { brain: 'numbers', action: 'continue', session_for_brain: open, close_session: false };
  }

  // 4. No session: the route names the brain.
  return { ...freshDecision(route, cmd, button), session_for_brain: null, close_session: false };
}

function freshDecision(route, cmd, button) {
  if (cmd === 'undo') return { brain: 'numbers', action: 'undo' };
  if (button) return { ...button };
  const brain = ROUTE_TO_BRAIN[route] || 'coach';
  const action = brain === 'numbers' ? 'new' : brain === 'help' ? 'menu' : 'answer';
  return { brain, action };
}

module.exports = { decideRoute, commandOf, ROUTE_TO_BRAIN, BUTTON_ACTIONS };
