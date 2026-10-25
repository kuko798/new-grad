/** Original neighborhood artwork, available without external image services. */
export function NeighborhoodScene() {
  const trees = [[93, 315], [165, 350], [377, 401], [432, 369], [491, 301], [147, 157], [207, 126], [480, 174]];
  return (
    <svg className="neighborhood-scene" viewBox="0 0 600 510" fill="none" aria-hidden="true">
      <defs>
        <pattern id="scene-grid" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><path d="M32 0H0V32" stroke="#426455" strokeOpacity=".065" /></pattern>
        <pattern id="scene-windows" width="24" height="26" patternUnits="userSpaceOnUse"><rect x="8" y="6" width="7" height="12" rx="1" fill="#d2dfcb" /></pattern>
        <linearGradient id="scene-ground" x1="110" y1="60" x2="520" y2="440" gradientUnits="userSpaceOnUse"><stop stopColor="#eff1e7" /><stop offset="1" stopColor="#dbe5d7" /></linearGradient>
      </defs>
      <rect width="600" height="510" fill="url(#scene-ground)" /><rect width="600" height="510" fill="url(#scene-grid)" />
      <ellipse cx="305" cy="385" rx="242" ry="86" fill="#193f34" opacity=".045" />
      <path d="m-20 371 405-235 244 140-407 237Z" fill="#c8d8cb" /><path d="m-20 354 405-235 244 140-407 237Z" fill="#f8f7ef" />
      <path d="m-12 394 412-239m-249 318L566 234" stroke="#d7ded2" strokeWidth="2" /><path d="m237 505 48-28L31 329l-47 27Zm387-256-49 28-253-146 49-28Z" fill="#c0d3c7" />
      <path d="m147 444 349-201" stroke="#91a89a" strokeWidth="2" strokeDasharray="7 9" />
      <path d="m71 313 98-57 92 53-98 57Z" fill="#acc89e" /><path d="m89 313 79-45 73 42-79 46Z" fill="#bdd0a8" />
      <path d="m334 391 79-46 83 48-79 46Z" fill="#abc69b" /><path d="m347 392 65-37 67 38-65 38Z" fill="#bdd0a8" />
      <path d="m195 271 74 43 65-38-74-43Z" fill="#c5c5ae" /><path d="m195 209 74 43v62l-74-43Z" fill="#e4c6a3" /><path d="m269 252 65-38v62l-65 38Z" fill="#b79d80" />
      <path d="m190 207 79 46 71-41-80-46Z" fill="#f0dbc0" /><path d="m198 206 62-36 63 36-62 36Z" fill="#ccae8e" />
      <path d="m207 246 53 31v30l-53-31Zm68 26 49-28v30l-49 29Z" fill="#344f40" />
      <path d="m203 239 62 36 2-11-62-36Zm64 25 63-36v11l-63 36Z" fill="#fff9e9" />
      <path d="m211 233 8 5v11l-8-5Zm16 9 8 5v11l-8-5Zm16 9 8 5v11l-8-5Zm32 8 8-5v11l-8 5Zm16-9 8-5v11l-8 5Zm16-9 8-5v11l-8 5Z" fill="#77946f" />
      <path d="m315 197 60 35v123l-60-35Z" fill="#bd795d" /><path d="m375 232 58-34v123l-58 34Z" fill="#99614d" />
      <path d="m311 195 64 37 63-36-64-37Z" fill="#e3b191" /><path d="m321 194 53-30 53 31-52 30Z" fill="#9d6957" /><path d="m325 218 40 23v90l-40-23Z" fill="url(#scene-windows)" />
      <path d="m385 243 9-5v15l-9 5Zm22-13 9-5v15l-9 5Zm-22 42 9-5v15l-9 5Zm22-13 9-5v15l-9 5Zm-22 42 9-5v15l-9 5Zm22-13 9-5v15l-9 5Z" fill="#ead4b3" />
      <path d="m341 166 13 7v-20l-13-7Z" fill="#bf8266" /><path d="m354 173 12-7v-20l-12 7Z" fill="#91604e" /><path d="m341 146 13 7 12-7-13-7Z" fill="#d8a487" />
      <path d="m162 165 51 30v-86l-51-30Z" fill="#e2d9ba" /><path d="m213 109 46-27v86l-46 27Z" fill="#b6b399" /><path d="m157 78 56 32 51-29-56-32Z" fill="#3e6253" />
      <path d="m170 120 10 6v17l-10-6Zm21 12 10 6v17l-10-6Zm-21-41 10 6v17l-10-6Zm21 12 10 6v17l-10-6Z" fill="#779184" /><path d="m224 117 10-6v17l-10 6Zm0 29 10-6v17l-10 6Zm18-69 10-6v17l-10 6Z" fill="#5c7868" />
      <path d="m104 204 48 28v-68l-48-28Z" fill="#d6aa87" /><path d="m152 164 44-25v68l-44 25Z" fill="#ae866a" /><path d="m99 134 53 31 49-29-53-30Z" fill="#f2dfc5" />
      <path d="m114 160 10 6v15l-10-6Zm18 11 10 6v15l-10-6Zm-18 16 10 6v15l-10-6Z" fill="#486a59" /><path d="m162 174 9-5v16l-9 5Zm17-10 9-5v16l-9 5Zm-17 34 9-5v16l-9 5Z" fill="#ead4b3" />
      {trees.map(([x, y], i) => <g key={i} transform={`translate(${x} ${y})`}><ellipse cy="4" rx="17" ry="8" fill="#365b43" opacity=".1" /><path d="M0 0v-28" stroke="#82785b" strokeWidth="4" /><ellipse cy="-32" rx="17" ry="25" fill={i % 2 ? '#6f9366' : '#426b4e'} /><path d="M0-53v39" stroke="#a9bf8d" strokeOpacity=".45" strokeWidth="1.5" /></g>)}
      <path d="m295 379 23-13m-23 7 23-13" stroke="#926e50" strokeWidth="4" /><path d="m298 378v7m17-17v7" stroke="#4d6755" strokeWidth="2" />
      <path d="M110 406c28-17 35-32 67-16s62 24 91 6l44-26" stroke="#427459" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" /><circle cx="110" cy="406" r="5" fill="#427459" stroke="#f8f7ef" strokeWidth="3" />
      <g transform="translate(291 122)"><circle r="29" fill="#d4e8a0" opacity=".45" /><path d="M0 18S-17 3-17-9a17 17 0 0 1 34 0C17 3 0 18 0 18Z" fill="#224d3c" /><circle cy="-9" r="6" fill="#e2efbd" /></g>
      <path d="M71 77h25m-12-12v25M481 424h19m-10-9v19" stroke="#72907a" strokeWidth="1.5" /><circle cx="459" cy="97" r="3" fill="#72907a" />
    </svg>
  );
}
