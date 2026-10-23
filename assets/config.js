export const CONFIG = Object.freeze({
  brandName: "Pakvaro",
  email: "hello@pakvaro.com",
  calendarUrl: "https://cal.com/vinay-tiwari-efqjhi/15min",
  linkedinUrl: "",
  founderPhoto: "assets/img/founder-vinay.webp"
});

export function contactHref(subject = "Workflow automation enquiry") {
  const query = new URLSearchParams({
    subject,
    body: `Hi ${CONFIG.brandName},\n\nI would like to discuss a project.\n\nGoal:\nSystems or device involved:\nTrigger or data source:\nWhat done must look like:\n`
  });
  // Mail apps do not decode "+" as a space in mailto links, so encode spaces as %20.
  return `mailto:${CONFIG.email}?${query.toString().replace(/\+/g, "%20")}`;
}

export function hydrateConfig(root = document) {
  root.querySelectorAll("[data-brand]").forEach((element) => {
    element.textContent = CONFIG.brandName;
  });

  root.querySelectorAll("[data-contact]").forEach((element) => {
    element.setAttribute("href", contactHref(element.dataset.subject));
  });

  root.querySelectorAll("[data-email]").forEach((element) => {
    element.textContent = CONFIG.email;
  });

  root.querySelectorAll("[data-calendar]").forEach((element) => {
    if (CONFIG.calendarUrl) {
      element.setAttribute("href", CONFIG.calendarUrl);
      element.hidden = false;
    } else {
      element.hidden = true;
    }
  });

  root.querySelectorAll("[data-book]").forEach((element) => {
    element.setAttribute("href", CONFIG.calendarUrl || contactHref("Intro call: workflow automation"));
    if (CONFIG.calendarUrl) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener");
    }
  });

  root.querySelectorAll("[data-linkedin]").forEach((element) => {
    if (CONFIG.linkedinUrl) {
      element.setAttribute("href", CONFIG.linkedinUrl);
      element.hidden = false;
    } else {
      element.hidden = true;
    }
  });

  root.querySelectorAll("[data-founder-avatar]").forEach((element) => {
    if (!CONFIG.founderPhoto) return;
    const photo = document.createElement("img");
    photo.width = 96;
    photo.height = 96;
    photo.alt = "Vinay Tiwari, Founder, Pakvaro";
    photo.loading = "lazy";
    photo.decoding = "async";
    // The initials stay underneath until the photo paints over them; a photo that fails to load is removed.
    photo.addEventListener("error", () => {
      photo.remove();
      element.classList.remove("has-photo");
    }, { once: true });
    photo.src = CONFIG.founderPhoto;
    element.append(photo);
    element.classList.add("has-photo");
  });

  if (document.title.includes("Pakvaro")) {
    document.title = document.title.replace("Pakvaro", CONFIG.brandName);
  }
}
