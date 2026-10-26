// All business claims below come from the original demo FAQ. No live data.
const entry = (id, text, questions) => ({ id, text, questions });
export const businesses = {
  realestate: {
    name: 'Northstar Properties', sector: 'Real estate',
    details: { fictional: true }, services: ['Rental and purchase inquiries'],
    faqs: [entry('property', 'Our sample agency handles rental and purchase inquiries. A team member can confirm current listings.', ['property', 'What properties do you handle?', 'What services do you offer?']),
      entry('viewing', 'Leave your preferred area and viewing date. A team member will confirm.', ['viewing', 'How do I arrange a viewing?'])],
    policies: ['Current listings and viewing arrangements require staff confirmation.']
  },
  auto: {
    name: 'Harbor Auto Service', sector: 'Automotive',
    details: { fictional: true }, services: ['Maintenance and inspections'],
    faqs: [entry('service', 'Our sample workshop handles maintenance and inspections. Staff will confirm availability.', ['service', 'What services do you offer?']),
      entry('price', 'Repair prices depend on the vehicle and inspection. Staff will prepare a quote.', ['price', 'How much do repairs cost?'])],
    policies: ['Availability and repair quotes require staff confirmation.']
  },
  retail: {
    name: 'Luma Home Store', sector: 'Retail',
    details: { fictional: true }, services: [],
    faqs: [entry('stock', 'A team member must confirm live stock. Please share the item and quantity.', ['stock', 'Is this item in stock?']),
      entry('delivery', 'Delivery depends on the destination. Staff can confirm options.', ['delivery', 'What are the delivery options?'])],
    policies: ['Live stock and delivery options require staff confirmation.']
  },
  hotel: {
    name: 'Aster House', sector: 'Hospitality',
    details: { fictional: true }, services: [],
    faqs: [entry('check-in', 'Sample check-in begins at 2 PM. Confirm with the property before travel.', ['check-in', 'What is check-in?', 'When can I check in?', 'What time is check-in?']),
      entry('booking', 'Leave your dates and guest count. Staff will confirm availability and rates.', ['booking', 'How do I book a room?'])],
    policies: ['Confirm check-in before travel. Availability and rates require staff confirmation.']
  }
};
function freeze(value) { Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); }); return Object.freeze(value); }
freeze(businesses);
export const getBusiness = id => typeof id === 'string' && Object.hasOwn(businesses, id) ? businesses[id] : undefined;
export function retrieveKnowledge(id) {
  const business = getBusiness(id);
  if (!business) throw new Error('Unknown business');
  return { name: business.name, sector: business.sector, details: business.details, services: business.services, policies: business.policies, facts: business.faqs };
}
export const normalize = text => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function demoSelection(knowledge, message) {
  return knowledge.facts.find(f => f.questions.some(q => normalize(q) === normalize(message)))?.id ?? null;
}
