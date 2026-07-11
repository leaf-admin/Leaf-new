export default function MaterialLineIcon({ name }) {
  const paths = {
    home: (
      <>
        <path d="M4 10.8 12 4l8 6.8" />
        <path d="M6 9.6V20h4.4v-5.2h3.2V20H18V9.6" />
      </>
    ),
    route: (
      <>
        <circle cx="6.2" cy="16" r="2.7" />
        <circle cx="17.8" cy="8" r="2.7" />
        <path d="M8.9 16h4a3.1 3.1 0 0 0 0-6.2h-1.8" />
      </>
    ),
    wallet: (
      <>
        <path d="M4.5 7.5h14.2a1.8 1.8 0 0 1 1.8 1.8v8.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V6.8A1.8 1.8 0 0 1 5.3 5h11.2" />
        <path d="M16 12.2h4.5v3.4H16a1.7 1.7 0 0 1 0-3.4Z" />
      </>
    ),
    trend: (
      <>
        <path d="M4 17.5 9.2 12l3.2 3.1L20 7.5" />
        <path d="M15 7.5h5v5" />
      </>
    ),
    settings: (
      <>
        <path d="M4.5 7.5h15" />
        <path d="M8.2 5.5v4" />
        <path d="M4.5 16.5h15" />
        <path d="M15.8 14.5v4" />
        <path d="M4.5 12h15" />
        <path d="M12 10v4" />
      </>
    ),
    menu: (
      <>
        <path d="M5 7h14" />
        <path d="M5 12h14" />
        <path d="M5 17h14" />
      </>
    ),
  };

  return (
    <svg className="material-line-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] || paths.home}
    </svg>
  );
}
