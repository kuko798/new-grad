import { Link } from 'react-router-dom';
import { Icon } from './Icon.tsx';

/** A useful next step, with the same city photography as the discovery page. */
export function PlannerEmpty({ kind }: { kind: 'saved' | 'compare' }) {
  return (
    <section className="planner-empty" aria-labelledby="empty-title">
      <div className="planner-empty-copy">
        <h2 id="empty-title">{kind === 'saved' ? 'Keep a few possibilities.' : 'See the tradeoffs.'}</h2>
        <p>{kind === 'saved'
          ? 'Nothing saved yet. Use Save on a neighborhood to build a shortlist you can come back to.'
          : 'Nothing selected to compare yet. Choose Compare on up to three neighborhoods to put rent, commute, and everyday amenities side by side.'}</p>
        <Link className="btn btn-primary" to="/">Choose a city <Icon name="arrowUpRight" size={18} /></Link>
      </div>
      <figure><img src="/images/chicago.jpg" width="1920" height="929" alt="Chicago skyline and park paths at dusk" /><figcaption>Chicago, Illinois · <a href="/images/credits.html">Photo credits</a></figcaption></figure>
    </section>
  );
}
