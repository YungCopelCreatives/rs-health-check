// Server-side copy of the links in assets/config.js (Vercel functions can't read browser globals).
// Files starting with "_" in /api are not exposed as endpoints.
module.exports = {
  siteUrl: process.env.SITE_URL || "https://rs-health-check.vercel.app",
  reviewsUrl: process.env.REVIEWS_URL || "https://share.google/OUZTOJVUBmAHKNHbx",
  aboutUrl: process.env.ABOUT_URL || "https://rs-health-check.vercel.app/about",
  calendlyUrl: process.env.CALENDLY_URL || "https://calendly.com/rsconsultadmin/30min",
};
