export const businesses = {
  realestate: {
    name: "Northstar Properties",
    sector: "Real estate",
    faq: [
      [
        "property",
        "Our sample agency handles rental and purchase inquiries. A team member can confirm current listings.",
      ],
      [
        "viewing",
        "Leave your preferred area and viewing date. A team member will confirm.",
      ],
    ],
  },
  auto: {
    name: "Harbor Auto Service",
    sector: "Automotive",
    faq: [
      [
        "service",
        "Our sample workshop handles maintenance and inspections. Staff will confirm availability.",
      ],
      [
        "price",
        "Repair prices depend on the vehicle and inspection. Staff will prepare a quote.",
      ],
    ],
  },
  retail: {
    name: "Luma Home Store",
    sector: "Retail",
    faq: [
      [
        "stock",
        "A team member must confirm live stock. Please share the item and quantity.",
      ],
      [
        "delivery",
        "Delivery depends on the destination. Staff can confirm options.",
      ],
    ],
  },
  hotel: {
    name: "Aster House",
    sector: "Hospitality",
    faq: [
      [
        "check-in",
        "Sample check-in begins at 2 PM. Confirm with the property before travel.",
      ],
      [
        "booking",
        "Leave your dates and guest count. Staff will confirm availability and rates.",
      ],
    ],
  },
};
export function answer(b, msg) {
  const text = String(msg).toLowerCase();
  const match = b.faq.find(([keyword]) => text.includes(keyword));
  return match
    ? match[1]
    : "I don't have verified information about that. Please leave an inquiry so a team member can help.";
}

export const isBusiness = (id) =>
  typeof id === "string" && Object.hasOwn(businesses, id);
