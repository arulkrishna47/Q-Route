import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Polyline, Tooltip, useMapEvents, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceDot } from 'recharts';
import { Activity, Map as MapIcon, Sliders, Database, Info, GitMerge, FileText, Settings, HelpCircle, AlertTriangle, Send, Zap } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const OPERATING_MODES = [
  { id: 'standard', name: 'Standard', desc: 'Balanced operation — the default for normal conditions.', weights: { time: 1.0, congestion: 1.0, co2: 1.0, penalty: 10.0 } },
  { id: 'peak', name: 'Peak Hour', desc: 'Prioritize getting vehicles through fastest during rush hour, even if some roads get busier.', weights: { time: 10.0, congestion: 1.0, co2: 1.0, penalty: 5.0 } },
  { id: 'emission', name: 'Low Emission Day', desc: 'Favor smoother, less stop-and-go routing to reduce estimated emissions — may take slightly longer.', weights: { time: 1.0, congestion: 1.0, co2: 10.0, penalty: 5.0 } },
  { id: 'relief', name: 'Congestion Relief', desc: 'Spread traffic more evenly across the network to relieve overloaded roads.', weights: { time: 1.0, congestion: 10.0, co2: 1.0, penalty: 20.0 } },
];

const SIGNAL_ICON_HTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>`;
const ADVISORY_ICON_HTML = `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg></div>`;

const signalIcon = new L.DivIcon({
  html: SIGNAL_ICON_HTML,
  className: 'custom-marker-icon custom-marker-signal',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

const advisoryIcon = new L.DivIcon({
  html: ADVISORY_ICON_HTML,
  className: 'custom-marker-icon custom-marker-advisory',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

function MapClickHandler({ onEdgeClick, network }: any) {
  useMapEvents({
    click(e) {
      if (!network) return;
      let minDist = Infinity;
      let nearestEdge = null;
      
      network.edges.forEach((edge: any) => {
        const u = network.nodes.find((n: any) => n.id === edge.u);
        const v = network.nodes.find((n: any) => n.id === edge.v);
        if (!u || !v) return;
        
        const d = Math.abs(e.latlng.lat - (u.lat + v.lat)/2) + Math.abs(e.latlng.lng - (u.lon + v.lon)/2);
        if (d < 0.005 && d < minDist) {
          minDist = d;
          nearestEdge = edge;
        }
      });
      
      if (nearestEdge) onEdgeClick(nearestEdge);
    },
  });
  return null;
}

function App() {
  const [viewMode, setViewMode] = useState<'operator' | 'analyst'>('operator');
  const [activeModeId, setActiveModeId] = useState('standard');
  const [hoveredActionKey, setHoveredActionKey] = useState<string | null>(null);
  
  const [locations, setLocations] = useState<any[]>([]);
  const [activeLocation, setActiveLocation] = useState<string>('');
  
  // Replay Animation state
  const [replayIteration, setReplayIteration] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(300);

  
  // Calibration thresholds
  const [peakStartHour, setPeakStartHour] = useState(8);
  const [peakEndHour, setPeakEndHour] = useState(10);
  const [peakStartHourPM, setPeakStartHourPM] = useState(17);
  const [peakEndHourPM, setPeakEndHourPM] = useState(19);
  const [congestionThreshold, setCongestionThreshold] = useState(0.85);

  const [network, setNetwork] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [activeTab, setActiveTab] = useState('comparison');
  
  const [weights, setWeights] = useState(OPERATING_MODES[0].weights);
  
  const [preOptState, setPreOptState] = useState<any>(null);
  const [suggestion, setSuggestion] = useState<{mode: string, reason: string} | null>(null);
  const [suggestionApplied, setSuggestionApplied] = useState<boolean | null>(null);
  
  const [baselineRes, setBaselineRes] = useState<any>(null);
  const [qpsoRes, setQpsoRes] = useState<any>(null);
  const [benchmarkRes, setBenchmarkRes] = useState<any>(null);
  
  useEffect(() => {
    let interval: any;
    if (isPlaying && qpsoRes && qpsoRes.edge_volumes_history) {
      interval = setInterval(() => {
        setReplayIteration((prev) => {
          if (prev === null) return 0;
          if (prev >= qpsoRes.edge_volumes_history.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, playbackSpeed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, qpsoRes, playbackSpeed]);
  const [benchmarking, setBenchmarking] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [explainData, setExplainData] = useState<any>(null);
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [modifiedCapacities, setModifiedCapacities] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchLocations();
  }, []);
  
  useEffect(() => {
    if (activeLocation) {
        // Reset state
        setNetwork(null);
        setBaselineRes(null);
        setQpsoRes(null);
        setBenchmarkRes(null);
        setHistory([]);
        setModifiedCapacities({});
        setPreOptState(null);
        setSuggestion(null);
        setReplayIteration(null);
        setIsPlaying(false);
        
        fetchNetwork(activeLocation);
        fetchHistory(activeLocation);
    }
  }, [activeLocation]);

  useEffect(() => {
    if (activeModeId !== 'custom') {
      const mode = OPERATING_MODES.find(m => m.id === activeModeId);
      if (mode) setWeights(mode.weights);
    }
  }, [activeModeId]);

  // Suggestion Engine
  useEffect(() => {
    const currentHour = new Date().getHours();
    const currentMin = new Date().getMinutes();
    const timeStr = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
    
    if ((currentHour >= peakStartHour && currentHour < peakEndHour) || 
        (currentHour >= peakStartHourPM && currentHour < peakEndHourPM)) {
      setSuggestion({ mode: 'peak', reason: `current time (${timeStr}) falls within the defined peak window` });
    } else if (preOptState && network) {
      let totalVC = 0;
      let validEdges = 0;
      network.edges.forEach((edge: any, i: number) => {
        const edgeCap = edge.capacity || 800;
        if (edgeCap > 0 && preOptState.edge_volumes && preOptState.edge_volumes[i] !== undefined) {
          totalVC += preOptState.edge_volumes[i] / edgeCap;
          validEdges++;
        }
      });
      const avgVC = validEdges > 0 ? totalVC / validEdges : 0;
      if (avgVC > congestionThreshold) {
        setSuggestion({ mode: 'relief', reason: `pre-optimization network average v/c (${avgVC.toFixed(2)}) exceeds threshold (${congestionThreshold})` });
      } else {
        setSuggestion({ mode: 'standard', reason: 'no elevated congestion or peak conditions detected' });
      }
    } else {
      setSuggestion(null);
    }
  }, [peakStartHour, peakEndHour, peakStartHourPM, peakEndHourPM, congestionThreshold, preOptState, network]);

  const handleApplySuggestion = (modeId: string) => {
    setActiveModeId(modeId);
    setSuggestionApplied(true);
  };
  
  const handleManualSelect = (modeId: string) => {
    setActiveModeId(modeId);
    if (suggestion && modeId === suggestion.mode) {
      setSuggestionApplied(true);
    } else {
      setSuggestionApplied(false);
    }
  };

  const handleWeightChange = (key: string, val: number) => {
    setWeights({...weights, [key]: val});
    setActiveModeId('custom');
    setSuggestionApplied(false);
  };

  const fetchLocations = async () => {
    try {
        const res = await axios.get(`${API_BASE}/locations`);
      setLocations(res.data);
      if (res.data.length > 0) setActiveLocation(res.data[0].id);
    } catch (e) { console.error(e); }
  };

  const fetchNetwork = async (loc: string) => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/network?location=${loc}`);
      const cleanNetwork = {
        ...res.data,
        edges: res.data.edges.map((e:any) => ({
            ...e,
            name: Array.isArray(e.name) ? e.name.join(', ') : e.name
        }))
      };
      setNetwork(cleanNetwork);
      
      const basePayload = { ...OPERATING_MODES[0].weights, silent: true };
      const baseRes = await axios.post(`${API_BASE}/optimize/baseline?location=${loc}`, basePayload);
      setPreOptState(baseRes.data);
      
      setLoading(false);
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };
  
  const fetchHistory = async (loc: string) => {
    try {
      const res = await axios.get(`${API_BASE}/experiments?location=${loc}`);
      setHistory(res.data);
    } catch(e) {}
  };

  const runOptimization = async () => {
    setOptimizing(true);
    try {
      let isFollowed = null;
      if (suggestion) {
        isFollowed = activeModeId === suggestion.mode;
      }
      
      const payload = { 
        ...weights, 
        modified_capacities: Object.keys(modifiedCapacities).length > 0 ? modifiedCapacities : null,
        silent: false,
        suggestion_shown: suggestion ? suggestion.mode : null,
        suggestion_followed: isFollowed
      };
      
      const [base, qpso] = await Promise.all([
        axios.post(`${API_BASE}/optimize/baseline?location=${activeLocation}`, payload),
        axios.post(`${API_BASE}/optimize/qpso?particles=20&iterations=30&location=${activeLocation}`, payload)
      ]);
      setBaselineRes(base.data);
      setQpsoRes(qpso.data);
      setReplayIteration(null);
      setIsPlaying(false);
      fetchHistory(activeLocation);
      if (viewMode === 'analyst') setActiveTab('comparison');
    } catch (e) {
      console.error(e);
    }
    setOptimizing(false);
  };
  
  const runBenchmark = async () => {
    setBenchmarking(true);
    try {
      const payload = { ...weights };
      const res = await axios.post(`${API_BASE}/benchmark?seeds=10&multiplier=1.0&location=${activeLocation}`, payload);
      setBenchmarkRes(res.data);
    } catch (e) {
      console.error(e);
    }
    setBenchmarking(false);
  };
  
  const handleEdgeClick = (edge: any) => {
    if (!whatIfMode) return;
    const key = `${edge.u}_${edge.v}_${edge.k}`;
    const newCaps = { ...modifiedCapacities };
    if (newCaps[key] === 0) delete newCaps[key];
    else newCaps[key] = 0;
    setModifiedCapacities(newCaps);
  };
  
  const fetchExplanation = async () => {
    try {
      if (!history || history.length === 0) return;
      const defaultOd = activeLocation === 'mylapore' ? '262793166_2216290056' : '1_2';
      const res = await axios.get(`${API_BASE}/explain/${defaultOd}?location=${activeLocation}`);
      if (res.data.status === 'ok') setExplainData(res.data);
      else alert(res.data.message);
    } catch (e) {}
  };

  if (loading) return <div className="p-8">Loading Network Data...</div>;

  let costDiffPercent = 0;
  let costImproved = false;
  let timeSavedMins = 0;
  let bottlenecksResolved = 0;
  let explanationText = "";
  
  const signalRecs: any[] = [];
  const advisoryRecs: any[] = [];
  let fleetRecs = 0;

  if (baselineRes && qpsoRes && network) {
    const bCost = baselineRes.fitness;
    const qCost = qpsoRes.fitness;
    costDiffPercent = Math.abs((bCost - qCost) / bCost) * 100;
    costImproved = qCost < bCost;
    
    timeSavedMins = (baselineRes.metrics.total_travel_time - qpsoRes.metrics.total_travel_time) / 60;
    bottlenecksResolved = baselineRes.metrics.capacity_violations_count - qpsoRes.metrics.capacity_violations_count;
    
    if (timeSavedMins <= 0 && baselineRes.metrics.capacity_violations_count === 0) {
      explanationText = "In low-demand, uncongested scenarios, the baseline shortest-path routing is already optimal. Q-ROUTE's stochastic search found a routing that is nearly as fast, but since there were no bottlenecks to avoid, travel time could not be further improved.";
    } else if (timeSavedMins < 0) {
      explanationText = "Travel time increased because your current settings prioritize lower emissions and fewer capacity violations far more heavily than raw speed. Try increasing the Travel Time weight to see faster (but more congested) routes instead.";
    } else if (bottlenecksResolved < 0) {
      explanationText = "Capacity violations increased because your current settings prioritize raw speed over spreading traffic out. Try increasing the Congestion or Penalty weights to resolve these bottlenecks.";
    }
    
    const diffMap = new Map();
    let fleetShiftCount = 0;
    
    network.edges.forEach((edge: any, i: number) => {
        const bVol = baselineRes.edge_volumes[i];
        let qVol = qpsoRes.edge_volumes[i];
        if (replayIteration !== null && qpsoRes.edge_volumes_history) {
            const histVols = qpsoRes.edge_volumes_history[replayIteration];
            if (histVols && histVols.length > i) qVol = histVols[i];
        }
        const diff = qVol - bVol;
        
        let roadName = Array.isArray(edge.name) ? edge.name[0] : edge.name;
        let isUnnamed = false;
        
        if (!roadName || String(roadName).trim() === '') {
          const adj = network.edges.find((e:any) => e.name && (e.u === edge.u || e.v === edge.u || e.u === edge.v || e.v === edge.v));
          if (adj) {
            let adjName = Array.isArray(adj.name) ? adj.name[0] : adj.name;
            roadName = `Unnamed segment near ${adjName}`;
          } else {
            roadName = 'Unnamed Road';
            isUnnamed = true;
          }
        }

        const edgeKey = `${edge.u}_${edge.v}_${edge.k}`;
        const uNode = network.nodes.find((n: any) => n.id === edge.u);
        const vNode = network.nodes.find((n: any) => n.id === edge.v);
        const lat = uNode && vNode ? (uNode.lat + vNode.lat) / 2 : 0;
        const lon = uNode && vNode ? (uNode.lon + vNode.lon) / 2 : 0;
        
        if (diffMap.has(roadName)) {
          const existing = diffMap.get(roadName);
          existing.diff += diff;
          existing.bVol += bVol;
          existing.qVol += qVol;
          existing.edgeKeys.push(edgeKey);
        } else {
          diffMap.set(roadName, { name: roadName, isUnnamed, edgeKeys: [edgeKey], diff, bVol, qVol, edgeCap: edge.capacity, lat, lon });
        }
        
        fleetShiftCount += Math.abs(diff) * 0.15;
    });
    
    const diffs = Array.from(diffMap.values()).map(d => {
      const pctIncrease = d.bVol > 0 ? (d.diff / d.bVol) * 100 : (d.diff > 0 ? 100 : 0);
      const pctDecrease = d.bVol > 0 ? (-d.diff / d.bVol) * 100 : 0;
      let severityText = "";
      const qVc = d.qVol / d.edgeCap;
      let isOverCapacity = qVc > 1.0;
      if (isOverCapacity) severityText = "pushing this road OVER capacity";
      else if (qVc > 0.7) severityText = "but remains within capacity";
      else severityText = "but remains comfortably free-flowing";
      return { ...d, pctIncrease, pctDecrease, severityText, qVc, isOverCapacity };
    });
    
    fleetRecs = Math.round(fleetShiftCount / 10);
    const signalSortScore = (d: any) => { let score = d.qVc; if (d.isUnnamed) score -= 1000; return score; };
    const advisorySortScore = (d: any) => { let score = Math.abs(d.diff); if (d.isUnnamed) score /= 1000; return score; };
    const sortedIncreases = [...diffs].filter(d => d.diff > 10).sort((a, b) => signalSortScore(b) - signalSortScore(a));
    signalRecs.push(...sortedIncreases.slice(0, 3)); 
    const sortedDecreases = [...diffs].filter(d => d.diff < -20).sort((a, b) => advisorySortScore(b) - advisorySortScore(a)); 
    advisoryRecs.push(...sortedDecreases.slice(0, 2));
  }
  
  const highlightKeys = new Set<string>();
  if (viewMode === 'operator') {
    signalRecs.forEach(r => r.edgeKeys.forEach((k:string) => highlightKeys.add(k)));
    advisoryRecs.forEach(r => r.edgeKeys.forEach((k:string) => highlightKeys.add(k)));
  }

  const renderMap = (title: string, subtitle: string, resultData: any, accentColor: string, isQpso: boolean = false) => {
    if (!network) return null;
    const lats = network.nodes.map((n: any) => n.lat);
    const lons = network.nodes.map((n: any) => n.lon);
    const center = [(Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lons) + Math.min(...lons)) / 2];

    return (
      <div className="map-wrapper" style={{height: '100%', position: 'relative', display: 'flex', flexDirection: 'column'}}>
        <div style={{padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)'}}>
          <h2>{whatIfMode && Object.keys(modifiedCapacities).length > 0 ? "WHAT-IF SCENARIO: " : ""}{title}</h2>
          <div className="map-subtitle">{subtitle}</div>
          <div className="map-context" style={{fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px'}}>
            {(() => {
              if (!resultData || !resultData.edge_volumes) return "";
              let congestedCount = 0;
              network.edges.forEach((edge: any, i: number) => {
                const edgeCap = modifiedCapacities[`${edge.u}_${edge.v}_${edge.k}`] !== undefined ? modifiedCapacities[`${edge.u}_${edge.v}_${edge.k}`] : edge.capacity;
                let vol = resultData.edge_volumes[i];
                if (isQpso && replayIteration !== null && resultData.edge_volumes_history) {
                    const histVols = resultData.edge_volumes_history[replayIteration];
                    if (histVols && histVols.length > i) vol = histVols[i];
                }
                if (edgeCap > 0 && (vol / edgeCap) >= 0.7) congestedCount++;
              });
              if (congestedCount === 0) return "This network currently has no congested roads — all segments are free-flowing under the simulated demand for this scenario.";
              return `${congestedCount} roads are at or above 70% capacity in this scenario — shown in amber/red below.`;
            })()}
          </div>
        </div>
        
        <div style={{flex: 1, position: 'relative', minHeight: 0}}>
          <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}>
            <MapContainer center={center as any} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="dark-map-tiles"
          />
          <MapClickHandler onEdgeClick={handleEdgeClick} network={network} />
          
          {network.edges.map((edge: any, i: number) => {
            const u = network.nodes.find((n: any) => n.id === edge.u);
            const v = network.nodes.find((n: any) => n.id === edge.v);
            if (!u || !v) return null;
            
            const key = `${edge.u}_${edge.v}_${edge.k}`;
            const isClosed = modifiedCapacities[key] === 0;
            const edgeCap = modifiedCapacities[key] !== undefined ? modifiedCapacities[key] : edge.capacity;
            
            let vol = 0;
            if (resultData && resultData.edge_volumes) {
                vol = resultData.edge_volumes[i];
                if (isQpso && replayIteration !== null && resultData.edge_volumes_history) {
                   const histVols = resultData.edge_volumes_history[replayIteration];
                   if (histVols && histVols.length > i) {
                       vol = histVols[i];
                   }
                }
            }

            let vc = edgeCap > 0 ? vol / edgeCap : 0;
            let color = isClosed ? '#ff0000' : (vol > 0 ? (vc > 1.0 ? '#ef4444' : vc > 0.7 ? '#eab308' : '#22c55e') : '#334155');
            let weight = isClosed ? 6 : Math.max(3, Math.min(8, vol / 50));
            
            const isHighlighted = isQpso && viewMode === 'operator' && highlightKeys.has(key);
            
            return (
              <Polyline 
                key={i} 
                positions={[[u.lat, u.lon], [v.lat, v.lon]]} 
                pathOptions={{ color, weight, opacity: isClosed ? 1 : (isHighlighted ? 1 : 0.6), dashArray: isClosed ? '5, 5' : undefined }}
              >
                <Tooltip direction="top">
                    <div className="mono">
                      <strong>{edge.name || 'Unnamed Road'}</strong><br/>
                      {isClosed ? 'CLOSED (WHAT-IF)' : (
                        <>
                          Vol: {Math.round(vol)}<br/>
                          Cap: {edgeCap} {modifiedCapacities[key] !== undefined ? '(MODIFIED)' : ''}<br/>
                          V/C: {vc.toFixed(2)}
                        </>
                      )}
                    </div>
                </Tooltip>
              </Polyline>
            );
          })}
        </MapContainer>
        </div>
        
        {isQpso && qpsoRes && qpsoRes.edge_volumes_history && (
            <div style={{
                position: 'absolute', bottom: '20px', left: '20px', right: '20px', 
                backgroundColor: 'var(--panel-bg)', padding: '1rem', borderRadius: '8px', 
                border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '1rem', zIndex: 1000
            }}>
                <button className="btn" style={{backgroundColor: 'var(--accent-qpso)', color: '#000'}} onClick={() => {
                    if (replayIteration === null) setReplayIteration(0);
                    setIsPlaying(!isPlaying);
                }}>
                    {isPlaying ? 'Pause' : 'Play'}
                </button>
                <input type="range" min="0" max={qpsoRes.edge_volumes_history.length - 1} 
                    value={replayIteration === null ? qpsoRes.edge_volumes_history.length - 1 : replayIteration}
                    onChange={(e) => { setReplayIteration(parseInt(e.target.value)); setIsPlaying(false); }}
                    style={{ flex: 1 }}
                />
                <span style={{color: '#fff', fontSize: '0.875rem'}}>Iter: {replayIteration === null ? qpsoRes.edge_volumes_history.length - 1 : replayIteration}</span>
                <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseInt(e.target.value))}>
                    <option value={600}>Slow</option><option value={300}>Normal</option><option value={100}>Fast</option>
                </select>
                <button className="btn" onClick={() => { setReplayIteration(null); setIsPlaying(false); }}>End</button>
            </div>
        )}
        </div>
      </div>
    );
  };

  const renderConvergence = () => {
    if (!qpsoRes || !qpsoRes.history) return null;
    const data = qpsoRes.history.map((val: number, i: number) => ({ iter: i, cost: val }));
    return (
      <div style={{height: '100%', width: '100%'}}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="iter" stroke="#94a3b8" />
            <YAxis domain={['auto', 'auto']} stroke="#94a3b8" />
            <Line type="monotone" dataKey="cost" stroke="var(--accent-qpso)" strokeWidth={2} />
            {replayIteration !== null && (
                <ReferenceDot x={replayIteration} y={qpsoRes.history[replayIteration]} r={6} fill="white" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <>
      <div className="top-nav">
        <div className="app-branding">
          <h1>Q-ROUTE</h1> <span>Quantum-Inspired Traffic Optimization</span>
          <select value={activeLocation} onChange={(e) => setActiveLocation(e.target.value)} style={{marginLeft: '2rem'}}>
            {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
          </select>
        </div>
        <div className="view-toggle">
          <button className={`view-btn ${viewMode === 'operator' ? 'active' : ''}`} onClick={() => setViewMode('operator')}>Operator</button>
          <button className={`view-btn ${viewMode === 'analyst' ? 'active' : ''}`} onClick={() => setViewMode('analyst')}>Analyst</button>
        </div>
      </div>

      <div className="dashboard-container">
        <div className="sidebar">
          <div className="sidebar-section">
            <div className="section-title"><Sliders size={16} /> OPERATING MODE</div>
            {suggestion && (
                <div className="suggestion-badge">
                    <strong>Suggested: {suggestion.mode}</strong>
                    <button className="btn" onClick={() => handleApplySuggestion(suggestion.mode)}>Apply</button>
                </div>
            )}
            {OPERATING_MODES.map(mode => (
              <button key={mode.id} className={`mode-select-btn ${activeModeId === mode.id ? 'active' : ''}`} onClick={() => handleManualSelect(mode.id)}>
                {mode.name}
              </button>
            ))}
            <button className="btn btn-primary" onClick={runOptimization} disabled={optimizing}>RUN OPTIMIZATION</button>
          </div>
                  </div>
        
        <div className="main-content">
          <div className="impact-banner">
            {(!baselineRes || !qpsoRes) ? (
              <div style={{textAlign: 'center', color: 'var(--text-secondary)', padding: '0.5rem'}}>
                Run optimization to see network impact
              </div>
            ) : (
              <>
                <div className="impact-stats">
                  <div className="impact-stat">
                    <span className="impact-stat-value" style={{color: costImproved ? 'var(--status-good)' : 'var(--status-warn)'}}>
                      {costImproved ? `${costDiffPercent.toFixed(1)}% more efficient network` : `${costDiffPercent.toFixed(1)}% less efficient network`}
                    </span>
                    <span className="impact-stat-label">Overall Network Efficiency</span>
                  </div>
                  <div className="impact-stat">
                    <span className="impact-stat-value" style={{color: timeSavedMins >= 0 ? 'var(--status-good)' : 'var(--status-warn)'}}>
                      {timeSavedMins >= 0 ? `${Math.round(timeSavedMins)} minutes saved` : `${Math.abs(Math.round(timeSavedMins))} fewer minutes of congestion delay`}
                    </span>
                    <span className="impact-stat-label">Across all vehicles</span>
                  </div>
                  <div className="impact-stat">
                    <span className="impact-stat-value" style={{color: bottlenecksResolved > 0 ? 'var(--status-good)' : (bottlenecksResolved === 0 ? 'inherit' : 'var(--status-critical)')}}>
                      {bottlenecksResolved > 0 ? `${bottlenecksResolved} bottlenecks resolved` : (bottlenecksResolved === 0 ? (baselineRes.metrics.capacity_violations_count === 0 ? `No roads over capacity — this scenario had no bottlenecks to begin with.` : `Bottlenecks remain unchanged`) : `${Math.abs(bottlenecksResolved)} more bottlenecks created`)}
                    </span>
                    <span className="impact-stat-label">Roads over capacity</span>
                  </div>
                </div>
                {explanationText && (
                  <div className="impact-explanation">
                    {explanationText}
                  </div>
                )}
              </>
            )}
          </div>
          
          {/* ACTION RECOMMENDATIONS (Operator Mode Only) */}
          {viewMode === 'operator' && baselineRes && qpsoRes && (
            <div className="action-panel">
              <div className="action-header">
                <Zap size={18} color="var(--accent-qpso)" /> Physical Action Recommendations
              </div>
              <div className="actions-grid">
                
                <div className="action-card">
                  <h3><Activity size={12} style={{display:'inline'}}/> SIGNAL RETIMING</h3>
                  {signalRecs.length > 0 ? signalRecs.map((rec, i) => (
                    <p key={i} style={{marginBottom: '0.5rem'}}>
                      <strong>{rec.name}</strong>: flow increased by {rec.pctIncrease.toFixed(0)}% under the optimized plan — consider extending green-phase time toward this direction.
                    </p>
                  )) : <p>No major signal adjustments required for this plan.</p>}
                </div>
                
                <div className="action-card">
                  <h3><AlertTriangle size={12} style={{display:'inline'}}/> TRAFFIC ADVISORIES</h3>
                  {advisoryRecs.length > 0 ? advisoryRecs.map((rec, i) => (
                    <p key={i} style={{marginBottom: '0.5rem'}}>
                      <strong>{rec.name}</strong>: recommend pushing a traffic advisory via GPS partners — the optimized plan reduces load here by {rec.pctDecrease.toFixed(0)}%.
                    </p>
                  )) : <p>No major advisory pushes required for this plan.</p>}
                </div>
                
                <div className="action-card">
                  <h3><Send size={12} style={{display:'inline'}}/> FLEET DISPATCH</h3>
                  {fleetRecs > 0 ? (
                    <p>
                      <strong>{fleetRecs}</strong> fleet-tagged routes changed under this plan — export updated routes to municipal/commercial dispatch systems immediately.
                    </p>
                  ) : <p>No priority fleet routes were affected by this optimization.</p>}
                </div>
                
              </div>
            </div>
          )}
          
          {/* MAPS */}
          {(!baselineRes || !qpsoRes) && (
            <div style={{padding: '2rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>
              <p>Select an Operating Mode and run optimization to see physical recommendations.</p>
            </div>
          )}

          {baselineRes && qpsoRes && viewMode === 'operator' && (
            <div className="maps-container">
              {renderMap('Target Physical Assignment', 'Implementing this plan requires the physical actions recommended above', qpsoRes, 'var(--accent-qpso)', true)}
            </div>
          )}

          {baselineRes && qpsoRes && viewMode === 'analyst' && activeTab === 'comparison' && (
            <>
              <div className="maps-container">
                {renderMap('Current Routing', 'each vehicle picks its own shortest path (Dijkstra / User Equilibrium)', baselineRes, 'var(--accent-baseline)', false)}
                {renderMap('Q-ROUTE Optimized', 'network-coordinated routing (quantum-inspired / System Optimum)', qpsoRes, 'var(--accent-qpso)', true)}
              </div>
              <div className="metrics-panel">
                <div className="kpi-grid">
                  <div className="kpi-card">
                    <span className="kpi-tooltip-icon" title="Total sum of travel time for all vehicles in the network, measured in vehicle-hours.">
                      <HelpCircle size={16} />
                    </span>
                    <div className="kpi-label">Total Travel Time</div>
                    <div className="kpi-value mono" style={{color: qpsoRes.metrics.total_travel_time < baselineRes.metrics.total_travel_time ? 'var(--status-good)' : 'inherit'}}>
                      ~{Math.round(qpsoRes.metrics.total_travel_time / 3600).toLocaleString()} vehicle-hours
                    </div>
                    <div className="kpi-sub mono">Base: ~{Math.round(baselineRes.metrics.total_travel_time / 3600).toLocaleString()} vehicle-hours</div>
                  </div>
                  <div className="kpi-card">
                    <span className="kpi-tooltip-icon" title="Number of road segments where the assigned traffic volume exceeds the physical capacity of the road.">
                      <HelpCircle size={16} />
                    </span>
                    <div className="kpi-label">Capacity Violations</div>
                    <div className="kpi-value mono" style={{color: qpsoRes.metrics.capacity_violations_count < baselineRes.metrics.capacity_violations_count ? 'var(--status-good)' : 'inherit'}}>
                      {qpsoRes.metrics.capacity_violations_count} Roads Over Capacity
                    </div>
                    <div className="kpi-sub mono">Base: {baselineRes.metrics.capacity_violations_count} Roads Over Capacity</div>
                  </div>
                  <div className="kpi-card" style={{gridColumn: 'span 2', display: 'flex'}}>
                    {renderConvergence()}
                  </div>
                </div>
              </div>
            </>
          )}
          
          {/* ANALYST VIEW TABS */}
          {viewMode === 'analyst' && activeTab === 'benchmark' && (
            <div style={{padding: '2rem', overflowY: 'auto', height: '100%'}}>
              <h2><GitMerge style={{display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle'}}/> Multi-Algorithm Benchmark (10 Seeds)</h2>
              <p style={{marginBottom: '2rem', color: 'var(--text-secondary)'}}>Comparing performance across deterministic and stochastic assignment models.</p>
              
              <button className="btn btn-primary" onClick={runBenchmark} disabled={benchmarking} style={{width: '200px', marginBottom: '2rem'}}>
                {benchmarking ? 'Running...' : 'Run Benchmarks Now'}
              </button>
              
              {benchmarkRes && (
                <table>
                  <thead>
                    <tr>
                      <th>Algorithm</th>
                      <th>Mean Cost Score</th>
                      <th>Std Dev</th>
                      <th>Best Cost Score</th>
                      <th>Worst Cost Score</th>
                      <th>Mean Travel Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(benchmarkRes).map(algo => (
                      <tr key={algo} style={{color: algo.includes('QPSO') ? 'var(--accent-qpso)' : 'inherit'}}>
                        <td>{algo}</td>
                        <td>{benchmarkRes[algo].cost_mean.toFixed(1)}</td>
                        <td>±{benchmarkRes[algo].cost_std.toFixed(1)}</td>
                        <td>{benchmarkRes[algo].cost_min.toFixed(1)}</td>
                        <td>{benchmarkRes[algo].cost_max.toFixed(1)}</td>
                        <td>~{Math.round(benchmarkRes[algo].time_mean/3600).toLocaleString()} veh-hrs</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              
              {benchmarkRes && (
                <div style={{marginTop: '2rem', padding: '1rem', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)'}}>
                  <h3 style={{color: 'var(--status-warn)', marginBottom: '0.5rem'}}>When does Q-ROUTE lose?</h3>
                  <p style={{color: 'var(--text-secondary)', lineHeight: '1.5'}}>
                    If demand is extremely low, or if the network is a perfect grid with no capacity constraints, the naive Dijkstra shortest-path (User Equilibrium) assignment generates zero bottlenecks. In such cases, QPSO's stochastic overhead is mathematically unnecessary, and it may occasionally settle on a local optimum slightly worse than the absolute shortest path. Q-ROUTE explicitly trades individual travel time for network-wide emission/congestion reduction, so its Travel Time metric will naturally rise when penalty weights are high.
                  </p>
                </div>
              )}
            </div>
          )}
          
          {viewMode === 'analyst' && activeTab === 'history' && (
            <div style={{padding: '2rem', overflowY: 'auto', height: '100%'}}>
              <h2><FileText style={{display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle'}}/> Experiments Log</h2>
              <p style={{marginBottom: '2rem', color: 'var(--text-secondary)'}}>Stored runs for reproducibility.</p>
              
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Algorithm</th>
                    <th>Scenario</th>
                    <th>Network Cost Score</th>
                    <th>Roads Over Capacity</th>
                    <th>Runtime</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice().reverse().map((run, i) => (
                    <tr key={i}>
                      <td>{new Date(run.timestamp).toLocaleString()}</td>
                      <td>{run.algorithm}</td>
                      <td><span className={run.scenario === 'what-if' ? 'provenance-tag provenance-derived' : 'provenance-tag provenance-observed'}>{run.scenario}</span></td>
                      <td>{run.fitness.toFixed(1)}</td>
                      <td>{run.metrics.capacity_violations_count}</td>
                      <td>{run.runtime.toFixed(2)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          
          {viewMode === 'analyst' && activeTab === 'explain' && (
            <div style={{padding: '2rem', overflowY: 'auto', height: '100%'}}>
              <h2><Info style={{display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle'}}/> Explainability (Example OD Pair)</h2>
              <p style={{marginBottom: '2rem', color: 'var(--text-secondary)'}}>Why did the algorithm choose this path?</p>
              
              {explainData ? (
                <div style={{padding: '1.5rem', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)'}}>
                  <p style={{fontSize: '1.1rem', lineHeight: '1.6', color: 'var(--accent-qpso)'}}>
                    "{explainData.explanation}"
                  </p>
                  <div style={{marginTop: '2rem', display: 'flex', gap: '2rem'}}>
                    <div>
                      <h4 style={{color: 'var(--accent-baseline)'}}>Current Routing (Dijkstra)</h4>
                      <p className="mono">Free-flow time: {(explainData.baseline_free_flow/60).toFixed(1)} mins</p>
                    </div>
                    <div>
                      <h4 style={{color: 'var(--accent-qpso)'}}>Q-ROUTE Optimized Shift</h4>
                      <p className="mono">Free-flow time: {(explainData.qpso_free_flow/60).toFixed(1)} mins</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p>Loading explanation...</p>
              )}
            </div>
          )}
          
        </div>
      </div>
    </>
  );
}

export default App;
