// Initial content for the "DMM Learning Platform" Google Sheet.
// Phase names come from the official Program Architecture table.
// Module titles come from the 20-week curriculum. Content not yet supplied is left blank on purpose.
const TABS = {
  Students:     ['email', 'name', 'password_hash', 'salt', 'preassessment_done', 'unlocked_phase', 'active', 'created_at', 'last_login'],
  Sessions:     ['token', 'email', 'expires_at'],
  Phases:       ['phase', 'title', 'weeks', 'focus', 'unlock_threshold'],
  Modules:      ['module_id', 'phase', 'order', 'week', 'title', 'description', 'ppt_url', 'notes_url', 'notes_text', 'resources', 'exercises', 'quiz_url', 'pass_mark', 'max_attempts', 'w_ppt', 'w_notes', 'w_exercises', 'w_quiz'],
  Progress:     ['email', 'module_id', 'item', 'value', 'updated_at'],
  Submissions:  ['email', 'module_id', 'exercise_id', 'text', 'submitted_at'],
  QuizAttempts: ['email', 'module_id', 'score', 'total', 'pct', 'passed', 'answers', 'attempted_at']
};

const students = [
  ['kavitaburrun@gmail.com', 'Kavita', '', '', 'TRUE', '', 'TRUE', '', ''],
  ['gaveenasee@gmail.com', 'Gaveena', '', '', 'TRUE', '', 'TRUE', '', ''],
  ['digitalmarketer@hseniva.com', 'Avinesh (trainer)', '', '', 'TRUE', '4', 'TRUE', '', '']
];

const phases = [
  [1, 'Digital Foundations', 'Weeks 1–4', 'Ecosystem, Analytics, SEO, Content Strategy', 100],
  [2, 'Core Channels & Paid Media', 'Weeks 5–10', 'Social Media, Google Ads, Meta Ads, Display, Email', 100],
  [3, 'Advanced Performance & AI', 'Weeks 11–16', 'Data Analysis, ROAS Optimization, AI Tools, Automation, E-commerce', 100],
  [4, 'Strategy & Leadership', 'Weeks 17–20', 'Digital Strategy, Reporting, Personal Branding, Capstone Project', 100]
];

const ex1 = [
  '1.1 | Digital Ecosystem Mapping | Map 10 digital platforms or channels and identify: which platforms your industry mainly uses; where your target customer is most active; what type of content performs best on each; which channels fit your business goals. Submit a link to your document or spreadsheet, or paste your mapping.',
  '1.2 | Platform Exploration | Explore Google (search your product or service and analyse the top results), Meta (find 3 competitors and analyse their posts), LinkedIn (identify thought leaders and popular content in your industry) and YouTube (find educational content in your niche). Submit a link to your screenshots and notes, or summarise your findings.'
].join('\n');

const ex2 = [
  '2.1 | GA4 Property Setup | Create a GA4 property named "Learning Property - [Your Name]", set up a Web data stream, note your Measurement ID (starts with G-) and explore the Reports, Explore and Admin sections. Submit a link to a screenshot showing the property and Measurement ID.',
  '2.2 | GTM Container Setup | Create a Google Tag Manager account and Web container, note your Container ID (starts with GTM-), copy the installation snippet and review the workspace. Submit a link to a screenshot showing the Container ID.',
  '2.3 | Event Tracking Plan | For 5 events (button click, form submission, video play, scroll depth, PDF download) document the trigger, the parameters captured, the GTM trigger needed and the GA4 event name. Submit a link to your document.'
].join('\n');

// [module_id, phase, order, week, title, description, ppt_url, notes_url, notes_text, resources, exercises, quiz_url, pass_mark, max_attempts, w_ppt, w_notes, w_exercises, w_quiz]
const M = (id, ph, ord, wk, title, desc, extra = {}) => [
  id, ph, ord, wk, title, desc,
  extra.ppt || '', extra.notesUrl || '', extra.notesText || '', extra.res || '', extra.ex || '', extra.quiz || '',
  70, '', 20, 20, 30, 30
];

const modules = [
  M('M1', 1, 1, 'Week 1', 'Digital Marketing Ecosystem', 'How the digital ecosystem fits together: channels, paid/owned/earned media, the funnel and customer journey, and the core tools.', {
    notesUrl: '/Module1-digitalfoundations',
    notesText: 'Read the Week 1 section of the Module 1 page: the digital ecosystem, the main channels and the 15-tool landscape.',
    ex: ex1, quiz: '/Exercise1-revision'
  }),
  M('M2', 1, 2, 'Week 2', 'Website & Analytics Foundations', 'GA4, Google Tag Manager and Looker Studio: measuring what happens on your website.', {
    notesUrl: '/Module1-digitalfoundations',
    notesText: 'Read the Week 2 section of the Module 1 page: GA4 event-based tracking and Google Tag Manager.',
    ex: ex2
  }),
  M('M3', 1, 3, 'Week 3', 'SEO Fundamentals', 'Deliverable: SEO Action Plan.'),
  M('M4', 1, 4, 'Week 4', 'Content Marketing & Strategy', 'Deliverable: Content Strategy Document.'),
  M('M5', 2, 1, 'Week 5', 'Social Media Marketing', 'Deliverable: Social Playbook.'),
  M('M6', 2, 2, 'Week 6', 'Google Ads: Search Fundamentals', 'Deliverable: Campaign Blueprint.'),
  M('M7', 2, 3, 'Week 7', 'Google Ads: Advanced Search & Optimisation', 'Deliverable: Performance Audit.'),
  M('M8', 2, 4, 'Week 8', 'Meta Ads: Facebook & Instagram', 'Deliverable: Meta Launch Plan.'),
  M('M9', 2, 5, 'Week 9', 'Display, Video & Programmatic Advertising', 'Deliverable: Awareness Campaign.'),
  M('M10', 2, 6, 'Week 10', 'Email Marketing & CRM', 'Deliverable: Email Strategy.'),
  M('M11', 3, 1, 'Week 11', 'Advanced Analytics & Data Mastery', 'Deliverable: Analytics Report.'),
  M('M12', 3, 2, 'Week 12', 'Performance Marketing & ROAS Optimisation', 'Deliverable: Performance Audit.'),
  M('M13', 3, 3, 'Week 13', 'AI in Digital Marketing, Part 1: Content Creation', 'Deliverable: AI Prompt Toolkit.'),
  M('M14', 3, 4, 'Week 14', 'AI in Digital Marketing, Part 2: Paid Media & Automation', 'Deliverable: AI Integration Plan.'),
  M('M15', 3, 5, 'Week 15', 'Marketing Automation & Lead Nurturing', 'Deliverable: Automation System.'),
  M('M16', 3, 6, 'Week 16', 'E-Commerce & Advanced Conversion Strategies', 'Deliverable: E-Commerce Growth Plan.'),
  M('M17', 4, 1, 'Week 17', 'Digital Marketing Strategy', 'Deliverable: 12-Month Strategy Document.'),
  M('M18', 4, 2, 'Week 18', 'Performance Reporting & Data Storytelling', 'Deliverable: Quarterly Report.'),
  M('M19', 4, 3, 'Week 19', 'Personal Branding & Career Acceleration', 'Deliverable: Personal Brand Strategy.'),
  M('M20', 4, 4, 'Week 20', 'Capstone Project & Certification', 'Deliverable: Full Strategy Presentation.')
];

function seed() {
  return {
    Students: [TABS.Students, ...students],
    Sessions: [TABS.Sessions],
    Phases: [TABS.Phases, ...phases],
    Modules: [TABS.Modules, ...modules],
    Progress: [TABS.Progress],
    Submissions: [TABS.Submissions],
    QuizAttempts: [TABS.QuizAttempts]
  };
}
module.exports = { seed, TABS };
