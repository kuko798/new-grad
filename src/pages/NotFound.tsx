import { Link } from 'react-router-dom';

export function NotFound({ message }: { message?: string }) {
  return (
    <div className="page">
      <h1 className="title">Page not found</h1>
      <p className="subtitle">{message ?? 'That address does not match a city or neighborhood we cover.'}</p>
      <p style={{ marginTop: 20 }}>
        <Link className="btn" to="/">Go to the start</Link>
      </p>
    </div>
  );
}
