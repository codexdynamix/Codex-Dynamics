import React, { useContext, useMemo } from 'react';
import { DataContext } from '../../shared';
import './Dashboard.css';

const fmt = (n) => (n == null ? '0' : Number(n).toLocaleString());

const STATUS_COLORS = {
  Deposit: '#30D158',
  'Failed Deposit': '#FF6464',
  New: '#0A84FF',
  'In Line': '#64D2FF',
  'No Answer': '#FFB020',
  'Call Back': '#BF5AF2',
  'Not Interested': '#8E8E93',
  'Low Potential': '#7B8392',
  'No Potential': '#5A6068',
  'Wrong Number': '#5A6068',
  'Wrong Person': '#5A6068',
  "Didn't Register": '#5A6068',
  NA1: 'var(--crm-text-secondary)',
  NA2: 'var(--crm-text-secondary)',
  NA3: 'var(--crm-text-secondary)',
  'Never Answer': 'var(--crm-text-secondary)',
};
const colorFor = (status) => STATUS_COLORS[status] || 'var(--crm-accent)';

const KpiCard = ({ label, value, sub, accent = 'var(--crm-accent)', icon }) => (
  <div className="crm-dashboard-card crm-dashboard-kpi" style={{ '--kpi-accent': accent }}>
    <div className="crm-dashboard-kpi-accent" />
    <div className="crm-dashboard-kpi-heading">
      <div className="crm-dashboard-kpi-label">{label}</div>
      <div className="crm-dashboard-kpi-icon">{icon}</div>
    </div>
    <div className="crm-dashboard-kpi-value">{value}</div>
    {sub && <div className="crm-dashboard-kpi-sub">{sub}</div>}
  </div>
);

const DonutChart = ({ data, size = 180, thickness = 26 }) => {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const radius = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={radius} fill="none" className="crm-inline-a894014cff" strokeWidth={thickness} />
      {data.map((d, i) => {
        const frac = d.value / total;
        const dash = frac * circumference;
        const gap = circumference - dash;
        const seg = (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            style={{ stroke: d.color }}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return seg;
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--crm-text-primary)">{fmt(total)}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize="11" className="crm-inline-8d8d2ff3d4">Clients</text>
    </svg>
  );
};

const HBar = ({ label, value, max, color = 'var(--crm-accent)', valueLabel }) => {
  const pct = max ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="crm-dashboard-hbar" style={{ '--bar-width': `${pct}%`, '--bar-color': color }}>
      <div className="crm-dashboard-hbar-labels">
        <span className="crm-dashboard-hbar-name">{label}</span>
        <span className="crm-dashboard-hbar-value">{valueLabel ?? fmt(value)}</span>
      </div>
      <div className="crm-dashboard-hbar-track">
        <div className="crm-dashboard-hbar-fill" />
      </div>
    </div>
  );
};

const Sparkline = ({ points, width = 600, height = 120, color = 'var(--crm-accent)', label }) => {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = width / Math.max(points.length - 1, 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - 16 - (p.value / max) * (height - 36);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const area = `${path} L ${(points.length - 1) * stepX} ${height - 16} L 0 ${height - 16} Z`;
  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="crm-inline-048b9a2b26">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1="0" x2={width} y1={(height - 16) * g + 4} y2={(height - 16) * g + 4} className="crm-inline-a894014cff" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="url(#spark-fill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => {
        const x = i * stepX;
        const y = height - 16 - (p.value / max) * (height - 36);
        return <circle key={i} cx={x} cy={y} r="2.5" fill={color} />;
      })}
      {points.map((p, i) =>
        i % Math.ceil(points.length / 7) === 0 || i === points.length - 1 ? (
          <text key={`l${i}`} x={i * stepX} y={height - 2} fontSize="9" fill="#7B8392" textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}>
            {p.label}
          </text>
        ) : null,
      )}
      {label && <text x="6" y="12" fontSize="10" className="crm-inline-8d8d2ff3d4">{label}</text>}
    </svg>
  );
};

const Dashboard = ({ offices = [], teams = [], staffUsers = [] }) => {
  const { clients = [], activityLog = [] } = useContext(DataContext) || {};

  const stats = useMemo(() => {
    const total = clients.length;
    const online = clients.filter((l) => l.isOnline).length;

    const agents = staffUsers.filter((u) => u.role === 'Agent').length;
    const teamLeaders = staffUsers.filter((u) => u.role === 'Team Leader').length;
    const officeManagers = staffUsers.filter((u) => u.role === 'Office Manager').length;

    return {
      total,
      online,
      agents,
      teamLeaders,
      officeManagers,
    };
  }, [clients, staffUsers]);

  const statusBreakdown = useMemo(() => {
    const counts = {};
    clients.forEach((l) => {
      const s = l.stage || l.clientstatus || 'New';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value, color: colorFor(name) }))
      .sort((a, b) => b.value - a.value);
  }, [clients]);

  const officePerformance = useMemo(() => {
    return offices.map((o) => {
      const officeClients = clients.filter((l) => (l.assignedToOffice || l.officeId) === o.id);
      const converted = officeClients.filter((l) => (l.stage || l.clientstatus) === 'Deposit').length;
      return {
        id: o.id,
        name: o.name,
        clients: officeClients.length,
        converted,
        conv: officeClients.length ? ((converted / officeClients.length) * 100).toFixed(1) : '0.0',
      };
    }).sort((a, b) => b.clients - a.clients);
  }, [offices, clients]);

  const topTeams = useMemo(() => {
    return teams.map((t) => {
      const tClients = clients.filter((l) => (l.assignedToTeam || l.teamId) === t.id);
      const converted = tClients.filter((l) => (l.stage || l.clientstatus) === 'Deposit').length;
      const office = offices.find((o) => o.id === t.officeId);
      return { id: t.id, name: t.name, office: office?.name || '-', clients: tClients.length, converted };
    }).sort((a, b) => b.converted - a.converted || b.clients - a.clients).slice(0, 6);
  }, [teams, clients, offices]);

  const trend = useMemo(() => {
    const days = 14;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, value: 0 });
    }
    const map = new Map(buckets.map((b) => [b.key, b]));
    clients.forEach((l) => {
      const k = (l.registeredDate || '').slice(0, 10);
      if (map.has(k)) map.get(k).value += 1;
    });
    return buckets;
  }, [clients]);

  const recentActivity = useMemo(() => (activityLog || []).slice(0, 8), [activityLog]);
  const onlineClients = useMemo(() => clients.filter((l) => l.isOnline).slice(0, 8), [clients]);

  const maxOfficeClients = officePerformance.length ? officePerformance[0].clients : 0;

  return (
    <div id="analytics-section" className="crm-admin-section">
      <h2>[chart] Analytics Dashboard</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 crm-mb-6">
        <KpiCard label="Total Clients" value={fmt(stats.total)} sub={`${fmt(stats.online)} online now`} accent="var(--crm-accent)" icon="[users]" />
        <KpiCard label="Offices" value={fmt(offices.length)} sub={`${fmt(stats.officeManagers)} managers`} accent="#BF5AF2" icon="[office]" />
        <KpiCard label="Teams" value={fmt(teams.length)} sub={`${fmt(stats.teamLeaders)} leaders`} accent="#64D2FF" icon="[users]" />
        <KpiCard label="Agents" value={fmt(stats.agents)} sub="Across all teams" accent="#FFB020" icon="[agent]" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 crm-mb-6">
        <div className="crm-dashboard-card">
          <h3>[status] Client Status Distribution</h3>
          <div className="crm-dashboard-status-content">
            <DonutChart data={statusBreakdown.length ? statusBreakdown : [{ name: 'No data', value: 1, color: 'var(--crm-card-hover)' }]} />
            <div className="crm-dashboard-status-list">
              {statusBreakdown.slice(0, 8).map((s) => (
                <div key={s.name} className="crm-dashboard-status-item">
                  <span className="crm-dashboard-status-swatch" style={{ '--status-color': s.color }} />
                  <span className="crm-dashboard-status-name">{s.name}</span>
                  <span className="crm-dashboard-status-value">{fmt(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="crm-dashboard-card lg:col-span-2">
          <h3>[office] Office Performance</h3>
          <div className="crm-dashboard-office-list">
            {officePerformance.length === 0 && <div className="crm-dashboard-empty">No offices yet.</div>}
            {officePerformance.map((o) => (
              <HBar
                key={o.id}
                label={o.name}
                value={o.clients}
                max={maxOfficeClients}
                color="var(--crm-accent)"
                valueLabel={`${fmt(o.clients)} clients  /  ${fmt(o.converted)} converted  /  ${o.conv}%`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="crm-dashboard-card crm-mb-6">
        <h3>[trend] New Clients - Last 14 Days</h3>
        <Sparkline points={trend} color="var(--crm-accent)" label="Daily registrations" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 crm-mb-6">
        <div className="crm-dashboard-card lg:col-span-2">
          <h3>[top] Top Performing Teams</h3>
          <div className="crm-dashboard-table-scroll">
            <table className="crm-dashboard-team-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Office</th>
                  <th className="is-numeric">Clients</th>
                  <th className="is-numeric">Converted</th>
                  <th className="is-numeric">Conv.</th>
                </tr>
              </thead>
              <tbody>
                {topTeams.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="is-office">{t.office}</td>
                    <td className="is-numeric">{fmt(t.clients)}</td>
                    <td className="is-numeric is-converted">{fmt(t.converted)}</td>
                    <td className="is-numeric is-rate">{t.clients ? `${((t.converted / t.clients) * 100).toFixed(1)}%` : '-'}</td>
                  </tr>
                ))}
                {topTeams.length === 0 && (
                  <tr><td colSpan={5} className="crm-dashboard-table-empty">No teams yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="crm-dashboard-card">
          <h3>[users] Online Clients</h3>
          <div className="crm-activity-feed">
            {onlineClients.length === 0 && (
              <div className="crm-dashboard-empty">No clients currently online.</div>
            )}
            {onlineClients.map((client) => (
              <div className="crm-activity-item" key={client.id}>
                <div className="crm-activity-icon crm-login crm-dashboard-online-icon">
                  <img src={`https://placehold.co/40x40/1e1e26/f0f0f5?text=${(client.name || '?').charAt(0)}`} className="rounded-full w-8 h-8" alt="" />
                  <div className="crm-dashboard-online-indicator" />
                </div>
                <div className="crm-activity-details">
                  <p className="crm-activity-message font-semibold">{client.name}</p>
                  <p className="crm-activity-timestamp">{client.email}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="crm-dashboard-card">
        <h3>[list] Recent Activity</h3>
        <div className="crm-activity-feed">
          {recentActivity.length === 0 && (
            <div className="crm-dashboard-empty">No recent activity recorded.</div>
          )}
          {recentActivity.map((item, index) => {
            const client = clients.find((l) => l.id === item.userId);
            const iconCls =
              item.type === 'login' ? 'fa-sign-in-alt'
              : item.type === 'failed-login' ? 'fa-exclamation-triangle'
              : item.type === 'password-change' ? 'fa-key'
              : 'fa-circle';
            const ts = item.timestamp ? new Date(item.timestamp) : null;
            return (
              <div className="crm-activity-item" key={index}>
                <div className={`crm-activity-icon ${item.type || ''}`}><i className={`fas ${iconCls}`}></i></div>
                <div className="crm-activity-details">
                  <p className="crm-activity-message"><b>{client ? client.name : 'Unknown'}</b> {item.details}</p>
                  <p className="crm-activity-timestamp">{ts ? ts.toLocaleString() : ''}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
