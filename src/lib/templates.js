// Fixed reply texts in English (en), Luganda (lg) and mixed. Every one stays within 60 words.
// {first_name} and {support_line} are filled by fill().

const TEMPLATES = {
  help_menu: {
    en: "Hi {first_name}! I'm Omulimu, your business coach. I can:\n1. Record today's sales and expenses and work out your profit\n2. Answer a question about your business\n3. Show today's record\nTap a button below or just type your message.",
    lg: "Ki kati {first_name}! Nze Omulimu, omutendesi wo mu bizinensi. Nsobola:\n1. Okuwandiika bye watunze ne bye wasaasaanyizza leero, n'okubala amagoba\n2. Okuddamu ekibuuzo ku bizinensi yo\n3. Okukulaga ebya leero\nNyiga eppeesa wansi oba wandiika obubaka bwo.",
    mixed: "Hi {first_name}! Nze Omulimu, your business coach. Nsobola:\n1. Record today's sales ne expenses, nkubalire profit\n2. Answer ekibuuzo ku business yo\n3. Show today's record\nTap eppeesa wansi oba just type message yo.",
  },
  help_ask: {
    en: "Type your business question and I'll answer it.",
    lg: 'Wandiika ekibuuzo kyo ku bizinensi, nja kukiddamu.',
    mixed: "Type ekibuuzo kyo ku business, I'll answer it.",
  },
  help_how: {
    en: "• You can ask any question about your business and Omulimu will help.\n• You get a reminder at 7pm to share your numbers.\n• All amounts are in UGX.\n• Type /help any time to see this menu.",
    lg: '• Osobola okubuuza ekibuuzo kyonna ku bizinensi yo, Omulimu n\'akuyamba.\n• Ofuna okujjukizibwa ku ssaawa emu ey\'akawungeezi (7pm) okuwandiika ennamba zo.\n• Ssente zonna ziri mu UGX.\n• Wandiika /help essaawa yonna okulaba menu eno.',
    mixed: "• Buuza any question ku business yo, Omulimu ajja kukuyamba.\n• Ofuna reminder at 7pm okuwandiika numbers zo.\n• Amounts zonna ziri mu UGX.\n• Type /help any time okulaba menu eno.",
  },
  today_none: {
    en: 'No record for today yet. Tap below to record today\'s numbers.',
    lg: 'Tewannaba kuwandiika bya leero. Nyiga wansi okuwandiika ennamba za leero.',
    mixed: "Tewali record ya today yet. Tap wansi to record today's numbers.",
  },
  care_open: {
    en: "I'm really sorry you're going through this. You matter more than any business, so let's pause the business talk. Please talk to someone today: call {support_line}. Someone from our team will also check on you. I'm here whenever you want to talk.",
    lg: "Nsonyiwa nnyo olw'ebikutuuseeko. Ggwe okulu okusinga bizinensi yonna, ka tuyimirizeemu eby'emirimu. Nkusaba oyogere n'omuntu leero: kuba ku {support_line}. Omuntu ow'ewaffe naye ajja kukubuuzaako. Ndi wano buli lw'oyagala okwogera.",
    mixed: "Nsonyiwa nnyo, I'm really sorry ku bikutuuseeko. You matter more than any business, ka tupause business talk. Please yogera n'omuntu leero: call {support_line}. Omuntu ow'ewaffe ajja kukubuuzaako. Ndi wano anytime.",
  },
  care_checkin: {
    en: "I'm still here with you. How are you feeling right now? There's no rush with the business. If things feel heavy, please call {support_line}. When you're ready to talk business again, just tell me.",
    lg: 'Nkyali wano naawe. Owulira otya kaakati? Tewali kwanguyiriza ku bya bizinensi. Ebintu bwe biba bizito, nkusaba okube ku {support_line}. Bw\'oba weetegese okuddamu okwogera ku bizinensi, ntegeeza bunnyonnyofu.',
    mixed: "Nkyali wano with you. Owulira otya right now? No rush ku business. Ebintu bwe biba heavy, please call {support_line}. When you're ready okwogera ku business nate, just tell me.",
  },
  coach_safe: {
    en: "Let's grow your business from its own profit. Write down every sale and expense each day, cut one cost this week, and put part of today's profit back into the item that sells fastest. Which item sells fastest for you?",
    lg: "Ka tukuze bizinensi yo okuva mu magoba gaayo. Wandiika buli ky'otunda ne buli ky'osaasaanya buli lunaku, kendeeza ku nsaasaanya emu wiiki eno, era ddiza ku magoba ga leero mu kintu ekitundibwa amangu. Kintu ki ekitundibwa amangu gy'oli?",
    mixed: "Ka tugrow business yo from its own profit. Wandiika buli sale ne expense daily, cut one cost this week, era put part ya today's profit mu item etundibwa fastest. Item ki etundibwa fastest gy'oli?",
  },
  fallback: {
    en: 'Nsonyiwa, waliwo ekizibu katono. Gezaako nate mu dakiika emu. / Sorry, something went wrong — try again in a minute.',
  },
  text_only: {
    en: 'Nsonyiwa, nsobola okusoma obubaka obw\'ebigambo bwokka kati. / Sorry, text only for now — please type your message.',
  },
  undo_done: {
    en: "Today's record has been removed. Send your numbers again any time.",
    lg: "Ebya leero bigiddwawo. Weereza ennamba zo nate essaawa yonna.",
    mixed: "Today's record egiddwawo. Send numbers zo nate any time.",
  },
  undo_none: {
    en: 'There is no record for today to remove.',
    lg: 'Tewali bya leero bya kuggyawo.',
    mixed: 'Tewali record ya today to remove.',
  },
};

const HELP_BUTTONS = [
  { text: "Record today's numbers", data: 'record' },
  { text: 'Ask a business question', data: 'ask' },
  { text: "Today's record", data: 'today' },
  { text: 'How Omulimu works', data: 'how' },
];

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

function t(key, language, vars) {
  const set = TEMPLATES[key];
  const text = set[language] || set.en;
  return fill(text, Object.assign({ first_name: 'there' }, vars || {}));
}

module.exports = { TEMPLATES, HELP_BUTTONS, fill, t };
