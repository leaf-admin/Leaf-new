export const getLangKey = (word) => {
  if (word) {
    return `${String(word)
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .join("_")
      .replace(/[.$#/[\]]/g, "")}_`;
  }
  return "";
};
