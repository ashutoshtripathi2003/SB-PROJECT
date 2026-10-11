import { ArrowRight, Car, ChevronRight, Footprints } from 'lucide-react'
import { fmtKm } from '@/lib/matching'
import { dayLabel, firstName, money, time } from '@/lib/format'
import type { MatchResult } from '@/lib/types'
import { MatchScore } from './MatchScore'
import { AiChance } from './AiHints'
import { WomenOnlyTag } from './Safety'
import { Avatar, Rating, cx } from './ui'

/**
 * Ride card — the one place riders compare options. Hierarchy:
 *   1. who (driver + trust)          2. AI match
 *   3. when + where + price          4. one supporting fact + action
 */
export function RideCard({ match, onOpen, active, showDay }: { match: MatchResult; onOpen: () => void; active?: boolean; showDay?: boolean }) {
  const { ride, driver, vehicle } = match
  const seatsLeft = ride.seatsTotal - ride.seatsBooked
  return (
    <button type="button" className={cx('ride-card', active && 'is-active')} onClick={onOpen} aria-label={`Ride with ${driver.name}, ${match.score}% match, departs ${time(ride.departAt)}, ${money(match.fare)} per seat`}>
      <div className="ride-card__head">
        <Avatar name={driver.name} src={driver.photo} verified={driver.verified} />
        <div className="ride-card__who">
          <div className="ride-card__name truncate">{driver.name}</div>
          <div className="ride-card__meta">
            <Rating value={driver.rating} count={driver.ridesOffered} />
          </div>
        </div>
        <MatchScore score={match.score} tier={match.tier} />
      </div>

      <div className="ride-card__route">
        <div className="stack">
          <span className="ride-card__time">{time(ride.departAt).replace(/ (AM|PM)/, '')}<span className="t-caption t-muted" style={{ marginLeft: 3 }}>{time(ride.departAt).slice(-2)}</span></span>
          {showDay && <span className="t-caption t-muted">{dayLabel(ride.departAt)}</span>}
        </div>
        <div className="ride-card__places">
          <span className="route-inline truncate" style={{ maxWidth: '100%' }}>
            <span className="truncate">{ride.origin.name}</span>
            <ArrowRight />
            <span className="truncate">{ride.destination.name}</span>
          </span>
          <div className="t-caption t-muted" style={{ fontWeight: 400 }}>
            {vehicle.make === 'Maruti Suzuki' ? 'Maruti' : vehicle.make} {vehicle.model} · {seatsLeft} {seatsLeft === 1 ? 'seat' : 'seats'} available
          </div>
        </div>
        <div className="ride-card__fare">
          <strong>{money(match.fare)}</strong>
          <span>{match.fareMax != null && match.fareMax > match.fare ? `/ seat · max ${money(match.fareMax)}` : '/ seat'}</span>
        </div>
      </div>

      <div className="ride-card__foot">
        <div className="ride-card__facts">
          {ride.womenOnly && <WomenOnlyTag />}
          <AiChance chance={match.aiChance} compact />
          <span>
            <Footprints />
            {match.pickupDistanceKm < 0.15 ? 'Pickup at your location' : `Pickup ${fmtKm(match.pickupDistanceKm)} away`}
          </span>
          {match.history && (
            <span className="only-desktop">
              <Car />
              Ridden with {firstName(driver.name)}
            </span>
          )}
        </div>
        <span className="row gap-1 t-sm t-strong t-primary">
          View ride
          <ChevronRight size={16} />
        </span>
      </div>
    </button>
  )
}
