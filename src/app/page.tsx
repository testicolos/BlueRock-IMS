const endpoints = [
  'GET /api/health',
  'POST /api/setup/bootstrap',
  'POST /api/auth/login',
  'GET/POST /api/locations',
  'PATCH/DELETE /api/locations/:id',
  'GET/POST /api/users',
  'PATCH /api/users/:id',
  'GET/POST /api/inventory',
  'GET/PATCH/DELETE /api/inventory/:id',
  'GET/POST /api/scans',
  'GET/POST /api/issues',
];

export default function Home() {
  return (
    <main className="wrap">
      <div className="brand"><div className="mark"/><div><h1>BlueRock IMS</h1><div className="muted">Inventory Management System</div></div></div>
      <p className="subtitle">Backend API foundation for tools, equipment and display sample tracking.</p>
      <section className="card">
        <div className="ok"><span className="dot"/>Backend is online</div>
        <p className="muted">Tools and samples share one audit-safe movement engine. Android and web clients will consume the same API.</p>
      </section>
      <section className="card">
        <h2>API Surface</h2>
        <div className="grid">{endpoints.map((value) => <div className="endpoint" key={value}><span className="method">{value.split(' ')[0]}</span> {value.substring(value.indexOf(' ')+1)}</div>)}</div>
      </section>
    </main>
  );
}
