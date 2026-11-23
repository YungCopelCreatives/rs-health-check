// RS Medical Consultancy's Google reviews, shown inside the WhatsApp chat ("What doctors say")
// and on /reviews. Copy each review exactly as it appears on Google; newest or strongest first.
// The bot shows the first three in the chat. While the list is empty, it sends the Google link instead.
(function (root) {
  const RS_REVIEWS = {
    googleUrl: "https://share.google/OUZTOJVUBmAHKNHbx",
    rating: null, // e.g. 5.0 (Google's average)
    count: null,  // e.g. 12 (number of Google reviews)
    reviews: [
      // { name: "Dr A. Venter", role: "General Practitioner", stars: 5, when: "October 2026", text: "..." },
    ],
  };
  if (typeof module !== "undefined" && module.exports) module.exports = RS_REVIEWS;
  else root.RS_REVIEWS = RS_REVIEWS;
})(this);
