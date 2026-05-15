const ratingButtons = Array.from(document.querySelectorAll(".rating button"));
const liveValues = Array.from(document.querySelectorAll(".live-value"));
const driverPoints = Array.from(document.querySelectorAll(".driver-point"));
const activeDriversLabel = document.querySelector("[data-active-drivers]");

ratingButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    ratingButtons.forEach((btn, i) => {
      btn.style.opacity = i <= index ? "1" : "0.36";
      btn.style.textShadow = i <= index ? "0 0 12px rgba(255, 204, 122, 0.72)" : "none";
    });
  });
});

const liveSequences = liveValues.map((element) => ({
  element,
  frames: (element.dataset.seq || "").split("|").filter(Boolean),
  index: 0,
}));

setInterval(() => {
  liveSequences.forEach((entry) => {
    if (entry.frames.length < 2) {
      return;
    }

    entry.index = (entry.index + 1) % entry.frames.length;
    entry.element.textContent = entry.frames[entry.index];
  });
}, 1600);

const activeDriversSequence = ["24", "23", "25", "24", "26", "24"];
let activeDriversIndex = 0;

setInterval(() => {
  if (activeDriversLabel) {
    activeDriversIndex = (activeDriversIndex + 1) % activeDriversSequence.length;
    activeDriversLabel.textContent = activeDriversSequence[activeDriversIndex];
  }

  if (!driverPoints.length) {
    return;
  }

  driverPoints.forEach((point) => point.classList.remove("focus"));
  const highlightIndex = Math.floor(Math.random() * driverPoints.length);
  driverPoints[highlightIndex].classList.add("focus");
}, 1800);
