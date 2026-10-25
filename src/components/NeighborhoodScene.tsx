/** Original neighborhood artwork, available without external image services. */
export function NeighborhoodScene() {
  const trees = [[93, 315], [165, 350], [377, 401], [432, 369], [491, 301], [147, 157], [207, 126], [480, 174]];
  return (
    <svg className="neighborhood-scene" viewBox="0 0 600 510" fill="none" aria-hidden="true">
      <defs>
        <pattern id="scene-grid" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)"><path d="M32 0H0V32" stroke="#718096" strokeOpacity=".065" /></pattern>
        <pattern id="scene-windows" width="24" height="26" patternUnits="userSpaceOnUse"><rect x="8" y="6" width="7" height="12" rx="1" fill="#e1e8f3" /></pattern>
        <linearGradient id="scene-ground" x1="110" y1="60" x2="520" y2="440" gradientUnits="userSpaceOnUse"><stop stopColor="#f6f8fb" /><stop offset="1" stopColor="#f6f8fb" /></linearGradient>
      </defs>
      <rect width="600" height="510" fill="url(#scene-ground)" /><rect width="600" height="510" fill="url(#scene-grid)" />
      <ellipse cx="305" cy="385" rx="242" ry="86" fill="#162139" opacity=".045" />
      <path d="m-20 371 405-235 244 140-407 237Z" fill="#dce3ed" /><path d="m-20 354 405-235 244 140-407 237Z" fill="#ffffff" />
      <path d="m-12 394 412-239m-249 318L566 234" stroke="#e6ebf1" strokeWidth="2" /><path d="m237 505 48-28L31 329l-47 27Zm387-256-49 28-253-146 49-28Z" fill="#d8e1ed" />
      <path d="m147 444 349-201" stroke="#a5b3c9" strokeWidth="2" strokeDasharray="7 9" />
      <path d="m71 313 98-57 92 53-98 57Z" fill="#b7cbbb" /><path d="m89 313 79-45 73 42-79 46Z" fill="#cbd9cc" />
      <path d="m334 391 79-46 83 48-79 46Z" fill="#b7cbbb" /><path d="m347 392 65-37 67 38-65 38Z" fill="#cbd9cc" />
      <path d="m195 271 74 43 65-38-74-43Z" fill="#a3b0c4" /><path d="m195 209 74 43v62l-74-43Z" fill="#d5deed" /><path d="m269 252 65-38v62l-65 38Z" fill="#a5b6d0" />
      <path d="m190 207 79 46 71-41-80-46Z" fill="#edf1f8" /><path d="m198 206 62-36 63 36-62 36Z" fill="#bdcbe1" />
      <path d="m207 246 53 31v30l-53-31Zm68 26 49-28v30l-49 29Z" fill="#3f567b" />
      <path d="m203 239 62 36 2-11-62-36Zm64 25 63-36v11l-63 36Z" fill="#ffffff" />
      <path d="m211 233 8 5v11l-8-5Zm16 9 8 5v11l-8-5Zm16 9 8 5v11l-8-5Zm32 8 8-5v11l-8 5Zm16-9 8-5v11l-8 5Zm16-9 8-5v11l-8 5Z" fill="#8299be" />
      <path d="m315 197 60 35v123l-60-35Z" fill="#9aafd1" /><path d="m375 232 58-34v123l-58 34Z" fill="#738cb4" />
      <path d="m311 195 64 37 63-36-64-37Z" fill="#c4d2e8" /><path d="m321 194 53-30 53 31-52 30Z" fill="#8d9fbd" /><path d="m325 218 40 23v90l-40-23Z" fill="url(#scene-windows)" />
      <path d="m385 243 9-5v15l-9 5Zm22-13 9-5v15l-9 5Zm-22 42 9-5v15l-9 5Zm22-13 9-5v15l-9 5Zm-22 42 9-5v15l-9 5Zm22-13 9-5v15l-9 5Z" fill="#e7eef9" />
      <path d="m341 166 13 7v-20l-13-7Z" fill="#9eafc9" /><path d="m354 173 12-7v-20l-12 7Z" fill="#7d91af" /><path d="m341 146 13 7 12-7-13-7Z" fill="#bdcbe1" />
      <path d="m162 165 51 30v-86l-51-30Z" fill="#d4dde8" /><path d="m213 109 46-27v86l-46 27Z" fill="#b4c0d0" /><path d="m157 78 56 32 51-29-56-32Z" fill="#4b6386" />
      <path d="m170 120 10 6v17l-10-6Zm21 12 10 6v17l-10-6Zm-21-41 10 6v17l-10-6Zm21 12 10 6v17l-10-6Z" fill="#8c9eb7" /><path d="m224 117 10-6v17l-10 6Zm0 29 10-6v17l-10 6Zm18-69 10-6v17l-10 6Z" fill="#6f86a8" />
      <path d="m104 204 48 28v-68l-48-28Z" fill="#bdcbe1" /><path d="m152 164 44-25v68l-44 25Z" fill="#8e9fbb" /><path d="m99 134 53 31 49-29-53-30Z" fill="#e6edf7" />
      <path d="m114 160 10 6v15l-10-6Zm18 11 10 6v15l-10-6Zm-18 16 10 6v15l-10-6Z" fill="#657d9f" /><path d="m162 174 9-5v16l-9 5Zm17-10 9-5v16l-9 5Zm-17 34 9-5v16l-9 5Z" fill="#e7eef9" />
      {trees.map(([x, y], i) => <g key={i} transform={`translate(${x} ${y})`}><ellipse cy="4" rx="17" ry="8" fill="#526e59" opacity=".1" /><path d="M0 0v-28" stroke="#8a8e99" strokeWidth="4" /><ellipse cy="-32" rx="17" ry="25" fill={i % 2 ? '#8aa28d' : '#698772'} /><path d="M0-53v39" stroke="#b8c9bb" strokeOpacity=".45" strokeWidth="1.5" /></g>)}
      <path d="m295 379 23-13m-23 7 23-13" stroke="#8592a6" strokeWidth="4" /><path d="m298 378v7m17-17v7" stroke="#65748b" strokeWidth="2" />
      <path d="M110 406c28-17 35-32 67-16s62 24 91 6l44-26" stroke="#335cff" strokeWidth="2.5" strokeDasharray="3 7" strokeLinecap="round" /><circle cx="110" cy="406" r="5" fill="#335cff" stroke="#ffffff" strokeWidth="3" />
      <g transform="translate(291 122)"><circle r="29" fill="#dce6ff" opacity=".45" /><path d="M0 18S-17 3-17-9a17 17 0 0 1 34 0C17 3 0 18 0 18Z" fill="#335cff" /><circle cy="-9" r="6" fill="#ffffff" /></g>
      <path d="M71 77h25m-12-12v25M481 424h19m-10-9v19" stroke="#9ba9be" strokeWidth="1.5" /><circle cx="459" cy="97" r="3" fill="#9ba9be" />
    </svg>
  );
}
