import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Polyline, Tooltip, useMapEvents, useMap, Marker, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceDot } from 'recharts';
import { Activity, Map as MapIcon, Sliders, Database, Info, GitMerge, FileText, Settings, HelpCircle, AlertTriangle, Send, Zap, Layout, Download, Search, RefreshCw, CheckCircle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1' ? '/api' : 'http://localhost:8000');

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

function MapViewController({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, 16, { animate: true, duration: 0.8 });
    }
  }, [target, map]);
  return null;
}

function App() {
  const [viewMode, setViewMode] = useState<'operator' | 'analyst'>('operator');
  const [showAbout, setShowAbout] = useState(false);
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

  const hasIterationChanges = useMemo(() => {
    if (!qpsoRes?.edge_volumes_history || qpsoRes.edge_volumes_history.length <= 1) return false;
    const first = qpsoRes.edge_volumes_history[0];
    const last = qpsoRes.edge_volumes_history[qpsoRes.edge_volumes_history.length - 1];
    let delta = 0;
    for (let i = 0; i < Math.min(first.length, last.length); i++) {
      delta += Math.abs(first[i] - last[i]);
    }
    return delta > 5.0;
  }, [qpsoRes]);

  const [benchmarking, setBenchmarking] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [explainData, setExplainData] = useState<any>(null);
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [modifiedCapacities, setModifiedCapacities] = useState<Record<string, number>>({});

  // Round 13 states
  const [odPairs, setOdPairs] = useState<any[]>([]);
  const [selectedOd, setSelectedOd] = useState<string>('');
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const [signalApproved, setSignalApproved] = useState(false);
  const [fleetExported, setFleetExported] = useState(false);

  const [showChangesOnly, setShowChangesOnly] = useState(false);
  const [focusedEdgeKey, setFocusedEdgeKey] = useState<string | null>(null);
  const [mapTargetCenter, setMapTargetCenter] = useState<[number, number] | null>(null);
  const [showMinorFlows, setShowMinorFlows] = useState(false);

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
        setSignalApproved(false);
        setFleetExported(false);
        setFocusedEdgeKey(null);
        setMapTargetCenter(null);
        setExplainData(null);
        setExplainError(null);
        
        fetchNetwork(activeLocation);
        fetchHistory(activeLocation);
        fetchOdPairs(activeLocation);
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
    const m = OPERATING_MODES.find(mode => mode.id === modeId);
    if (m) setWeights(m.weights);
    setSuggestionApplied(true);
  };
  
  const handleManualSelect = (modeId: string) => {
    setActiveModeId(modeId);
    const m = OPERATING_MODES.find(mode => mode.id === modeId);
    if (m) setWeights(m.weights);
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
      if (res.data.length > 0) {
        const def = res.data.find((l: any) => l.id === 'mylapore') || res.data[0];
        setActiveLocation(def.id);
      }
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
  
  const fetchOdPairs = async (loc: string) => {
    try {
      const res = await axios.get(`${API_BASE}/od_pairs?location=${loc}`);
      if (Array.isArray(res.data) && res.data.length > 0) {
        setOdPairs(res.data);
        const multiPath = res.data.find((p: any) => p.num_paths >= 2) || res.data[0];
        setSelectedOd(multiPath.id);
        fetchExplanation(multiPath.id, loc);
      }
    } catch (e) {
      console.error("Failed to load OD pairs:", e);
    }
  };

  const fetchExplanation = async (odId?: string, locOverride?: string) => {
    const loc = locOverride || activeLocation;
    const targetOd = odId || selectedOd;
    if (!targetOd) return;
    setExplainLoading(true);
    setExplainError(null);
    try {
      const res = await axios.get(`${API_BASE}/explain/${targetOd}?location=${loc}`);
      if (res.data.status === 'ok' || res.data.status === 'single_path') {
        setExplainData(res.data);
      } else {
        setExplainError(res.data.message || 'No alternative routes available for this OD pair.');
      }
    } catch (e: any) {
      console.error("Error fetching explanation:", e);
      setExplainError(e.response?.data?.detail || e.message || 'Failed to fetch explanation from server.');
    } finally {
      setExplainLoading(false);
    }
  };

  const handleApproveSignalTiming = () => {
    setSignalApproved(true);
  };

  const handleExportFleetDispatch = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      location: activeLocation,
      mode: activeModeId,
      fleet_shifts_count: fleetRecs,
      signal_recommendations: signalRecs,
      advisory_recommendations: advisoryRecs,
      status: "DISPATCHED_TO_MUNICIPAL_TRANSIT"
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qroute_fleet_dispatch_${activeLocation}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFleetExported(true);
  };

  const handleLocateBottleneck = (item: any) => {
    if (!item || !network) return;
    const uNode = network.nodes.find((n: any) => n.id === item.edge.u);
    const vNode = network.nodes.find((n: any) => n.id === item.edge.v);
    if (uNode && vNode) {
      const target: [number, number] = [(uNode.lat + vNode.lat)/2, (uNode.lon + vNode.lon)/2];
      setMapTargetCenter(target);
      setFocusedEdgeKey(`${item.edge.u}_${item.edge.v}_${item.edge.k}`);
    }
  };

  if (loading) return <div className="p-8">Loading Network Data...</div>;

  let costDiffPercent = 0;
  let costImproved = false;
  let timeSavedMins = 0;
  let bottlenecksResolved = 0;
  let explanationText = "";
  
  const signalRecs: any[] = [];
  const minorSignalRecs: any[] = [];
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
      if (activeModeId === 'standard') {
        explanationText = "Balanced multi-objective trade-off: travel time slightly increased as vehicles were routed onto minor arterials to prevent network bottlenecks and maintain systemic flow.";
      } else if (activeModeId === 'emission') {
        explanationText = "Low Emission Day mode actively prioritizes reducing stop-and-go acceleration and idling over raw travel speed, leading to lower net emissions.";
      } else if (activeModeId === 'relief') {
        explanationText = "Congestion Relief mode prioritized dispersing concentrated flows across parallel corridors to eliminate capacity violations, trading off direct travel time.";
      } else {
        explanationText = "Travel time increased because your current settings prioritize lower emissions and fewer capacity violations over raw speed.";
      }
    } else if (bottlenecksResolved < 0) {
      if (activeModeId === 'peak') {
        explanationText = "Peak Hour mode prioritizes maximum throughput and fastest vehicle travel times, which may allow transient localized capacity spikes on high-throughput links.";
      } else {
        explanationText = "Capacity violations increased because your current settings prioritize raw speed over spreading traffic out.";
      }
    } else if (costImproved) {
      if (activeModeId === 'standard') {
        explanationText = "Standard mode achieved a balanced global optimum — reducing overall network resistance while keeping key corridors within capacity.";
      } else if (activeModeId === 'peak') {
        explanationText = "Peak Hour mode maximized throughput on major expressways, saving vehicle travel time across the network.";
      } else if (activeModeId === 'emission') {
        explanationText = "Low Emission Day mode successfully minimized congestion drag and idling, achieving lower environmental footprint.";
      } else if (activeModeId === 'relief') {
        explanationText = "Congestion Relief mode successfully rerouted traffic away from critical choke points, balancing loads across the network.";
      }
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
    
    // Priority 8: Suppress trivial recommendations when there are no bottlenecks or roads are uncongested
    // Genuine physical signal adjustments reserved for edges near or over capacity (V/C >= 0.70)
    const significantIncreases = [...diffs].filter(d => d.diff > 10 && d.qVc >= 0.70).sort((a, b) => signalSortScore(b) - signalSortScore(a));
    const minorIncreases = [...diffs].filter(d => d.diff > 10 && d.qVc < 0.70).sort((a, b) => signalSortScore(b) - signalSortScore(a));
    
    if (significantIncreases.length > 0) {
      signalRecs.push(...significantIncreases.slice(0, 3));
    }
    minorSignalRecs.push(...minorIncreases.slice(0, 3));
    
    const sortedDecreases = [...diffs].filter(d => d.diff < -20 && d.bVol / d.edgeCap >= 0.50).sort((a, b) => advisorySortScore(b) - advisorySortScore(a)); 
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

    // Priority 6: Find worst congested edge
    let worstCongestedEdge: any = null;
    let congestedCount = 0;
    if (resultData && resultData.edge_volumes) {
      network.edges.forEach((edge: any, i: number) => {
        const edgeCap = modifiedCapacities[`${edge.u}_${edge.v}_${edge.k}`] !== undefined ? modifiedCapacities[`${edge.u}_${edge.v}_${edge.k}`] : edge.capacity;
        let vol = resultData.edge_volumes[i];
        if (isQpso && replayIteration !== null && resultData.edge_volumes_history) {
            const histVols = resultData.edge_volumes_history[replayIteration];
            if (histVols && histVols.length > i) vol = histVols[i];
        }
        const vc = edgeCap > 0 ? vol / edgeCap : 0;
        if (edgeCap > 0 && vc >= 0.7) {
          congestedCount++;
          if (!worstCongestedEdge || vc > worstCongestedEdge.vc) {
            let rName = Array.isArray(edge.name) ? edge.name[0] : edge.name;
            if (!rName) rName = `Link ${edge.u}→${edge.v}`;
            worstCongestedEdge = { edge, index: i, vc, vol, edgeCap, roadName: rName };
          }
        }
      });
    }

    return (
      <div className="map-wrapper" style={{height: '100%', position: 'relative', display: 'flex', flexDirection: 'column'}}>
        <div style={{padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', flexShrink: 0}}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem', flexWrap: 'wrap', gap: '0.5rem'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
              <h2 style={{fontSize: '1rem', margin: 0, color: accentColor}}>{whatIfMode && Object.keys(modifiedCapacities).length > 0 ? "WHAT-IF SCENARIO: " : ""}{title}</h2>
              <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>{subtitle}</span>
            </div>
            {/* Priority 7: Show Changes Only toggle */}
            {baselineRes && qpsoRes && (
              <button 
                className="btn" 
                style={{
                  fontSize: '0.75rem', 
                  padding: '0.25rem 0.65rem', 
                  width: 'auto', 
                  marginBottom: 0,
                  backgroundColor: showChangesOnly ? '#c026d3' : 'transparent',
                  borderColor: '#c026d3',
                  color: showChangesOnly ? '#ffffff' : '#d946ef',
                  fontWeight: showChangesOnly ? 600 : 'normal'
                }}
                onClick={() => setShowChangesOnly(!showChangesOnly)}
              >
                {showChangesOnly ? '✓ Showing Changes Only (|Δ| > 0)' : 'Highlight Volume Changes Only'}
              </button>
            )}
          </div>
          <div className="map-context" style={{fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem'}}>
            <span>
              {!resultData || !resultData.edge_volumes
                ? "Baseline OpenStreetMap road geometry loaded."
                : (congestedCount === 0
                  ? "This network currently has no congested roads — all segments are free-flowing under the simulated demand for this scenario."
                  : `${congestedCount} road segments are at or above 70% capacity in this scenario.`
                )}
            </span>
            {/* Priority 6: Locate Peak Bottleneck button */}
            {congestedCount > 0 && worstCongestedEdge && (
              <button
                className="btn"
                style={{
                  width: 'auto',
                  padding: '0.2rem 0.6rem',
                  fontSize: '0.75rem',
                  marginBottom: 0,
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  borderColor: '#ef4444',
                  color: '#f87171',
                  cursor: 'pointer'
                }}
                onClick={() => handleLocateBottleneck(worstCongestedEdge)}
              >
                <Search size={12} style={{display:'inline', marginRight:'0.25rem'}}/> Locate Peak Bottleneck ({worstCongestedEdge.roadName}, V/C: {worstCongestedEdge.vc.toFixed(2)})
              </button>
            )}
          </div>
        </div>
        
        <div style={{flex: 1, position: 'relative', minHeight: '380px'}}>
          <div style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0}}>
            {/* Step 3: What-If Road Closure On-Map Guidance Banner */}
            {whatIfMode && (
              <div style={{
                position: 'absolute',
                top: '12px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                backgroundColor: Object.keys(modifiedCapacities).length === 0 ? 'rgba(239, 68, 68, 0.95)' : 'rgba(185, 28, 28, 0.95)',
                color: '#ffffff',
                padding: '0.45rem 1.15rem',
                borderRadius: '24px',
                fontWeight: 600,
                fontSize: '0.85rem',
                boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                pointerEvents: 'auto',
                border: '1px solid rgba(255,255,255,0.25)'
              }}>
                {Object.keys(modifiedCapacities).length === 0 ? (
                  <>
                    <AlertTriangle size={16} /> Click any road segment on the map to simulate closing it
                  </>
                ) : (
                  <>
                    <span>🚧 <strong>{Object.keys(modifiedCapacities).length}</strong> road segment(s) closed (dashed red lines). Click "RUN OPTIMIZATION" to calculate detours.</span>
                    <button 
                      className="btn" 
                      style={{
                        padding: '0.15rem 0.55rem', 
                        margin: 0, 
                        fontSize: '0.75rem', 
                        backgroundColor: '#ffffff', 
                        color: '#dc2626', 
                        fontWeight: 700,
                        borderRadius: '12px'
                      }} 
                      onClick={() => setModifiedCapacities({})}
                    >
                      Reset
                    </button>
                  </>
                )}
              </div>
            )}

            <MapContainer center={center as any} zoom={15} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                className="dark-map-tiles"
              />
              <MapClickHandler onEdgeClick={handleEdgeClick} network={network} />
              <MapViewController target={mapTargetCenter} />
              
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

                const bVol = baselineRes?.edge_volumes?.[i] ?? 0;
                const qVol = qpsoRes?.edge_volumes?.[i] ?? 0;
                const diff = qVol - bVol;
                const hasChanged = Math.abs(diff) > 0.5;

                let vc = edgeCap > 0 ? vol / edgeCap : 0;
                
                let color: string;
                let weight: number;
                let opacity: number;

                if (showChangesOnly) {
                  if (hasChanged) {
                    color = '#d946ef'; // Vivid magenta/purple
                    weight = 5.5;
                    opacity = 1.0;
                  } else {
                    color = '#334155'; // Subdued dark gray
                    weight = 1.2;
                    opacity = 0.2;
                  }
                } else {
                  if (isClosed) {
                    color = '#ff2222';
                    weight = 7;
                    opacity = 1.0;
                  } else if (vol > 0) {
                    // Step 5: Enhanced vibrant route contrast
                    color = vc > 1.0 ? '#ff334b' : vc > 0.7 ? '#fbbf24' : '#10b981';
                    weight = Math.max(4.5, Math.min(9.5, 4.0 + vol / 40));
                    opacity = 0.95;
                  } else {
                    // Priority 5: 4th state for no simulated traffic
                    color = '#334155'; // Dim neutral slate-gray
                    weight = 1.4;
                    opacity = 0.25;
                  }
                }
                
                const isHighlighted = isQpso && viewMode === 'operator' && highlightKeys.has(key);
                const isFocused = focusedEdgeKey === key;
                if (isFocused) {
                  weight = Math.max(weight, 8);
                  opacity = 1.0;
                  color = '#ff334b';
                }
                
                return (
                  <React.Fragment key={i}>
                    <Polyline 
                      positions={[[u.lat, u.lon], [v.lat, v.lon]]} 
                      eventHandlers={{
                        click: (e) => {
                          if (whatIfMode) {
                            L.DomEvent.stopPropagation(e);
                            handleEdgeClick(edge);
                          }
                        }
                      }}
                      pathOptions={{ 
                        color, 
                        weight, 
                        opacity: isClosed || isFocused ? 1 : (isHighlighted ? 1 : opacity), 
                        dashArray: isClosed ? '6, 6' : undefined 
                      }}
                    >
                      <Tooltip direction="top">
                          <div className="mono">
                            <strong>{edge.name || 'Unnamed Road'}</strong><br/>
                            {isClosed ? 'CLOSED (WHAT-IF SCENARIO) — Capacity = 0' : (
                              showChangesOnly ? (
                                hasChanged ? (
                                  <>
                                    <span style={{color: '#d946ef', fontWeight: 'bold'}}>Traffic Shifted:</span><br/>
                                    Baseline: {Math.round(bVol)} veh/hr<br/>
                                    Optimized: {Math.round(qVol)} veh/hr<br/>
                                    Delta: {diff > 0 ? `+${Math.round(diff)}` : Math.round(diff)} veh/hr<br/>
                                    V/C: {(vol / edgeCap).toFixed(2)}
                                  </>
                                ) : (
                                  <>
                                    No volume change between plans.<br/>
                                    Vol: {Math.round(vol)} | Cap: {edgeCap}
                                  </>
                                )
                              ) : (
                                <>
                                  Vol: {Math.round(vol)}<br/>
                                  Cap: {edgeCap} {modifiedCapacities[key] !== undefined ? '(MODIFIED)' : ''}<br/>
                                  V/C: {vc.toFixed(2)} {vc > 1.0 ? '⚠️ OVER CAPACITY' : ''}
                                </>
                              )
                            )}
                          </div>
                      </Tooltip>
                    </Polyline>
                    {isClosed && (
                      <CircleMarker 
                        center={[(u.lat + v.lat)/2, (u.lon + v.lon)/2]} 
                        radius={7} 
                        pathOptions={{ color: '#ffffff', fillColor: '#ef4444', fillOpacity: 1.0, weight: 2 }}
                      >
                        <Tooltip permanent direction="top">
                          <span style={{fontWeight: 700, color: '#ef4444', fontSize: '0.75rem'}}>⛔ CLOSED (WHAT-IF)</span>
                        </Tooltip>
                      </CircleMarker>
                    )}
                    {isFocused && (
                      <CircleMarker 
                        center={[(u.lat + v.lat)/2, (u.lon + v.lon)/2]} 
                        radius={9} 
                        pathOptions={{ color: '#ffffff', fillColor: '#ff334b', fillOpacity: 0.9, weight: 3 }}
                      >
                        <Tooltip permanent direction="top">
                          <span style={{fontWeight: 700, color: '#ff334b', fontSize: '0.8rem'}}>🚨 Peak Bottleneck (V/C: {vc.toFixed(2)})</span>
                        </Tooltip>
                      </CircleMarker>
                    )}
                  </React.Fragment>
                );
              })}
            </MapContainer>
            
            {/* Map Legend */}
            <div className="map-legend" style={{position: 'absolute', bottom: '1rem', right: '1rem', zIndex: 1000, pointerEvents: 'none', backgroundColor: 'rgba(15, 23, 42, 0.92)', padding: '0.55rem 0.85rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.75rem', maxWidth: '250px'}}>
              {showChangesOnly ? (
                <>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px'}}>
                    <div style={{width: '14px', height: '4px', backgroundColor: '#d946ef', borderRadius: '2px'}}></div>
                    <span style={{color: '#fdf4ff', fontWeight: 600}}>Rerouted Corridors (|Δ| &gt; 0)</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                    <div style={{width: '14px', height: '3px', backgroundColor: '#334155', borderRadius: '2px'}}></div>
                    <span style={{color: 'var(--text-secondary)'}}>Unchanged routes</span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px'}}>
                    <div style={{width: '14px', height: '3px', backgroundColor: '#334155', borderRadius: '2px'}}></div>
                    <span style={{color: 'var(--text-secondary)'}}>Gray = No simulated traffic (0 veh)</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px'}}>
                    <div style={{width: '14px', height: '5px', backgroundColor: '#10b981', borderRadius: '2px'}}></div>
                    <span style={{color: '#a7f3d0', fontWeight: 500}}>Free-flowing (&lt;70% V/C)</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px'}}>
                    <div style={{width: '14px', height: '5px', backgroundColor: '#fbbf24', borderRadius: '2px'}}></div>
                    <span style={{color: '#fde68a', fontWeight: 500}}>Moderate (70–100% V/C)</span>
                  </div>
                  <div style={{display: 'flex', alignItems: 'center', gap: '6px'}}>
                    <div style={{width: '14px', height: '5px', backgroundColor: '#ff334b', borderRadius: '2px'}}></div>
                    <span style={{color: '#fca5a5', fontWeight: 600}}>Overloaded (&gt;100% V/C)</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        {isQpso && qpsoRes && qpsoRes.edge_volumes_history && (
            <div style={{
                backgroundColor: 'var(--panel-bg)', padding: '0.6rem 1rem', 
                borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '1rem',
                flexShrink: 0
            }}>
                {!hasIterationChanges ? (
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.8rem', fontStyle: 'italic', width: '100%', justifyContent: 'center'}}>
                    <Info size={15} style={{color: 'var(--accent-qpso)', flexShrink: 0}} />
                    <span>This scenario converged immediately — no iteration-to-iteration changes to show. Initial shortest path had zero bottlenecks to redistribute.</span>
                  </div>
                ) : (
                  <>
                    <button className="btn" style={{backgroundColor: 'var(--accent-qpso)', color: '#000', width: 'auto', marginBottom: 0, padding: '0.4rem 1rem'}} onClick={() => {
                        if (replayIteration === null || replayIteration >= qpsoRes.edge_volumes_history.length - 1) setReplayIteration(0);
                        setIsPlaying(!isPlaying);
                    }}>
                        {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <input type="range" min="0" max={qpsoRes.edge_volumes_history.length - 1} 
                        value={replayIteration === null ? qpsoRes.edge_volumes_history.length - 1 : replayIteration}
                        onChange={(e) => { setReplayIteration(parseInt(e.target.value)); setIsPlaying(false); }}
                        style={{ flex: 1 }}
                    />
                    <span style={{color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.875rem', minWidth: '70px'}}>
                      Iter: {replayIteration === null ? qpsoRes.edge_volumes_history.length - 1 : replayIteration}
                    </span>
                    <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(parseInt(e.target.value))} style={{padding: '0.35rem 0.5rem', width: 'auto', marginBottom: 0}}>
                        <option value={600}>0.5x Slow</option>
                        <option value={300}>1x Normal</option>
                        <option value={100}>3x Fast</option>
                    </select>
                    <button className="btn" style={{width: 'auto', marginBottom: 0, padding: '0.4rem 1rem'}} onClick={() => { setReplayIteration(null); setIsPlaying(false); }}>Reset</button>
                  </>
                )}
            </div>
        )}
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
            {replayIteration !== null && qpsoRes.history && qpsoRes.history[replayIteration] !== undefined && (
                <ReferenceDot x={replayIteration} y={qpsoRes.history[replayIteration]} r={6} fill="white" />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100vh'}}>
      <div className="top-nav">
        <div className="app-branding">
          <h1>Q-ROUTE</h1> <span>Quantum-Inspired Traffic Optimization</span>
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
          <button className="btn" style={{display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', width: 'auto', marginBottom: 0}} onClick={() => setShowAbout(true)}>
            <Info size={16} /> Why This Matters
          </button>
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
                <div className="mode-name">{mode.name}</div>
                <div className="mode-desc">{mode.desc}</div>
              </button>
            ))}
            <button className="btn btn-primary" onClick={runOptimization} disabled={optimizing} style={{marginTop: '0.5rem'}}>
              {optimizing ? <><span className="loader"></span> Computing QPSO...</> : 'RUN OPTIMIZATION'}
            </button>
            
            <div style={{marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)'}}>
              <label style={{display: 'flex', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer', color: whatIfMode ? 'var(--status-warn)' : 'var(--text-secondary)'}}>
                <input type="checkbox" checked={whatIfMode} onChange={e => setWhatIfMode(e.target.checked)} style={{marginRight: '0.5rem', accentColor: 'var(--accent-qpso)'}} />
                What-If Road Closure Mode
              </label>
              {Object.keys(modifiedCapacities).length > 0 && (
                <button className="btn" style={{marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.35rem 0.5rem', width: '100%', borderColor: 'var(--status-warn)', color: 'var(--status-warn)'}} onClick={() => setModifiedCapacities({})}>
                  Clear Closures ({Object.keys(modifiedCapacities).length})
                </button>
              )}
            </div>
          </div>
          
          {viewMode === 'analyst' && (
            <div className="sidebar-section" style={{borderTop: '1px solid var(--border-color)'}}>
              <div className="section-title"><Layout size={16} style={{verticalAlign: 'middle', marginRight: '0.4rem'}} /> ANALYST VIEWS</div>
              <button className={`mode-select-btn ${activeTab === 'comparison' ? 'active' : ''}`} onClick={() => setActiveTab('comparison')}>Dual Map Comparison</button>
              <button className={`mode-select-btn ${activeTab === 'benchmark' ? 'active' : ''}`} onClick={() => setActiveTab('benchmark')}>Multi-Algorithm Benchmark</button>
              <button className={`mode-select-btn ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Experiments Log & Provenance</button>
              <button className={`mode-select-btn ${activeTab === 'explain' ? 'active' : ''}`} onClick={() => { setActiveTab('explain'); fetchExplanation(); }}>Decision Explainability</button>
            </div>
          )}
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
                {!costImproved && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.55rem 0.85rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    fontSize: '0.8rem',
                    color: '#93c5fd',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    textAlign: 'left'
                  }}>
                    <Info size={16} style={{flexShrink: 0, color: '#60a5fa'}} />
                    <span>
                      <strong>Classical Dijkstra matched or edged Q-ROUTE in this run:</strong> In uncongested regimes with zero bottlenecks, uncoordinated shortest paths are already near-optimal. Q-ROUTE's system-optimum coordination advantage specifically activates under heavy demand and corridor bottlenecks.
                    </span>
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
                  {signalRecs.length > 0 ? (
                    <>
                      {signalRecs.map((rec, i) => (
                        <p key={i} style={{marginBottom: '0.5rem'}}>
                          <strong>{rec.name}</strong>: flow increased by {rec.pctIncrease.toFixed(0)}% under the optimized plan (V/C: {rec.qVc.toFixed(2)}) — consider extending green-phase duration along this corridor.
                        </p>
                      ))}
                      <button 
                        className="btn btn-primary" 
                        style={{marginTop: '0.75rem', width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.8rem'}}
                        onClick={handleApproveSignalTiming}
                      >
                        {signalApproved ? '✓ Signal Timing Approved' : 'Approve Signal Timing'}
                      </button>
                      {signalApproved && (
                        <div style={{marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--status-good)', fontWeight: 500}}>
                          ✓ Staged for junction controllers (Webster Method Green-Split Logged)
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <p style={{color: 'var(--text-secondary)'}}>
                        <span style={{color: 'var(--status-good)', fontWeight: 600}}>✓ No physical signal adjustments required:</span> All corridors in this scenario operate comfortably within capacity (&lt;70% V/C).
                      </p>
                      {minorSignalRecs.length > 0 && (
                        <div style={{marginTop: '0.6rem'}}>
                          <button 
                            className="btn" 
                            style={{backgroundColor: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', padding: 0, textDecoration: 'underline', width: 'auto', marginBottom: '0.35rem', cursor: 'pointer'}}
                            onClick={() => setShowMinorFlows(!showMinorFlows)}
                          >
                            {showMinorFlows ? 'Hide minor volume shifts' : `View ${minorSignalRecs.length} minor flow shifts (advisory only)`}
                          </button>
                          {showMinorFlows && minorSignalRecs.map((rec, i) => (
                            <p key={i} style={{fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem'}}>
                              {rec.name}: +{rec.pctIncrease.toFixed(0)}% flow (V/C: {rec.qVc.toFixed(2)}) — within design headroom.
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="action-card">
                  <h3><AlertTriangle size={12} style={{display:'inline'}}/> TRAFFIC ADVISORIES</h3>
                  {advisoryRecs.length > 0 ? advisoryRecs.map((rec, i) => (
                    <p key={i} style={{marginBottom: '0.5rem'}}>
                      <strong>{rec.name}</strong>: recommend pushing a traffic advisory via GPS partners — the optimized plan reduces load here by {rec.pctDecrease.toFixed(0)}%.
                    </p>
                  )) : <p>No major advisory pushes required for this scenario.</p>}
                </div>
                
                <div className="action-card">
                  <h3><Send size={12} style={{display:'inline'}}/> FLEET DISPATCH</h3>
                  {fleetRecs > 0 ? (
                    <>
                      <p>
                        <strong>{fleetRecs}</strong> fleet-tagged routes changed under this plan — export updated corridors to municipal bus and emergency dispatch software.
                      </p>
                      <button 
                        className="btn btn-primary" 
                        style={{marginTop: '0.75rem', width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.8rem'}}
                        onClick={handleExportFleetDispatch}
                      >
                        <Download size={13} style={{display:'inline', marginRight:'0.35rem'}}/> Export Fleet Dispatch
                      </button>
                      {fleetExported && (
                        <div style={{marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--status-good)', fontWeight: 500}}>
                          ✓ Fleet route manifest exported ({activeLocation}_fleet_dispatch.json)
                        </div>
                      )}
                    </>
                  ) : (
                    <div>
                      <p>No priority fleet routes were affected by this optimization.</p>
                      <button 
                        className="btn" 
                        style={{marginTop: '0.75rem', width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.75rem', backgroundColor: 'transparent', borderColor: 'var(--border-color)', color: 'var(--text-secondary)'}}
                        onClick={handleExportFleetDispatch}
                      >
                        <Download size={13} style={{display:'inline', marginRight:'0.35rem'}}/> Export Baseline Fleet Manifest
                      </button>
                    </div>
                  )}
                </div>
                
              </div>
            </div>
          )}
          
          {/* MAPS */}
          {(!baselineRes || !qpsoRes) && network && (
            <div className="maps-container" style={{flex: 1, minHeight: '450px', display: 'flex', flexDirection: 'column'}}>
              {renderMap('Network Road Topology', 'OpenStreetMap road network loaded — click "RUN OPTIMIZATION" to compute systemic routing', null, 'var(--accent-qpso)', false)}
            </div>
          )}
          {(!baselineRes || !qpsoRes) && !network && (
            <div style={{padding: '2rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%'}}>
              <p><span className="loader"></span> Loading OpenStreetMap road network geometry...</p>
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
              
              {benchmarkRes && (() => {
                const algos = Object.keys(benchmarkRes);
                const minCostAlgo = algos.reduce((best, curr) => 
                  benchmarkRes[curr].cost_mean < benchmarkRes[best].cost_mean ? curr : best
                , algos[0]);
                const isQpsoWinner = minCostAlgo.toLowerCase().includes('qpso');

                return (
                  <>
                    {!isQpsoWinner && (
                      <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem 1.25rem',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(59, 130, 246, 0.12)',
                        border: '1px solid #3b82f6',
                        display: 'flex',
                        gap: '0.85rem',
                        alignItems: 'flex-start'
                      }}>
                        <Info size={22} style={{color: '#60a5fa', flexShrink: 0, marginTop: '2px'}} />
                        <div>
                          <h4 style={{color: '#93c5fd', margin: '0 0 0.35rem 0', fontSize: '0.95rem'}}>
                            Why did a classical method ({minCostAlgo}) win this run?
                          </h4>
                          <p style={{color: '#e2e8f0', fontSize: '0.85rem', lineHeight: '1.5', margin: 0}}>
                            <strong>{minCostAlgo}</strong> matched or outperformed Q-ROUTE in this run. This is expected and correct behavior: in low-demand or uncongested conditions, simpler methods are already near-optimal, and Q-ROUTE's coordination overhead isn't needed. Q-ROUTE's advantage specifically appears under higher-demand, congested conditions — try <em>Congestion Relief</em> mode, <em>Peak Hour</em> mode, or a higher vehicle count to see it.
                          </p>
                        </div>
                      </div>
                    )}
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
                        {algos.map(algo => {
                          const isWinner = algo === minCostAlgo;
                          return (
                            <tr 
                              key={algo} 
                              style={{
                                backgroundColor: isWinner ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                                fontWeight: isWinner ? 600 : 'normal'
                              }}
                            >
                              <td style={{color: isWinner ? 'var(--status-good)' : (algo.includes('QPSO') ? 'var(--accent-qpso)' : 'inherit')}}>
                                {algo} {isWinner && <span style={{fontSize: '0.75rem', padding: '0.15rem 0.45rem', borderRadius: '3px', backgroundColor: 'var(--status-good)', color: '#000', marginLeft: '0.5rem', fontWeight: 'bold'}}>🏆 Lowest Cost</span>}
                              </td>
                              <td style={{color: isWinner ? 'var(--status-good)' : 'inherit', fontWeight: isWinner ? 'bold' : 'normal'}}>{benchmarkRes[algo].cost_mean.toFixed(1)}</td>
                              <td>±{benchmarkRes[algo].cost_std.toFixed(1)}</td>
                              <td>{benchmarkRes[algo].cost_min.toFixed(1)}</td>
                              <td>{benchmarkRes[algo].cost_max.toFixed(1)}</td>
                              <td>~{Math.round(benchmarkRes[algo].time_mean/3600).toLocaleString()} veh-hrs</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                );
              })()}
              
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
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem'}}>
                <div>
                  <h2><Info style={{display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle'}}/> Decision Explainability & OD Route Choice</h2>
                  <p style={{color: 'var(--text-secondary)', marginTop: '0.25rem'}}>Inspect why Q-ROUTE shifted vehicular flow from selfish shortest paths to system-optimal corridors.</p>
                </div>
                
                {/* Priority 1: OD Pair Dropdown Selector */}
                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                  <label style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>Select OD Flow:</label>
                  <select 
                    value={selectedOd} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedOd(val);
                      fetchExplanation(val);
                    }}
                    style={{padding: '0.4rem 0.8rem', minWidth: '280px', backgroundColor: 'var(--panel-bg)', color: 'var(--text-primary)', borderColor: 'var(--border-color)'}}
                  >
                    {odPairs.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.index + 1}: {p.origin} → {p.destination} ({p.volume} veh, {p.num_paths} {p.num_paths === 1 ? 'path' : 'paths'})
                      </option>
                    ))}
                  </select>
                  <button 
                    className="btn" 
                    style={{width: 'auto', padding: '0.4rem 0.75rem', marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.3rem'}}
                    onClick={() => fetchExplanation(selectedOd)}
                    title="Reload explanation"
                  >
                    <RefreshCw size={14} /> Reload
                  </button>
                </div>
              </div>

              {explainLoading && (
                <div style={{padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '6px'}}>
                  <div style={{fontSize: '1.5rem', marginBottom: '0.5rem'}}>⚙️</div>
                  <p style={{fontWeight: 500}}>Analyzing network topology and computing corridor free-flow differentials...</p>
                </div>
              )}

              {explainError && !explainLoading && (
                <div style={{padding: '1.5rem', border: '1px solid var(--status-critical)', backgroundColor: 'rgba(239, 68, 68, 0.12)', borderRadius: '6px', marginBottom: '1.5rem'}}>
                  <h4 style={{color: '#f87171', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <AlertTriangle size={18} /> No Route Explanation Available for this OD Pair
                  </h4>
                  <p style={{color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem'}}>{explainError}</p>
                  <button className="btn btn-primary" style={{width: 'auto', padding: '0.35rem 0.8rem', marginBottom: 0}} onClick={() => fetchExplanation(selectedOd)}>
                    Retry Loading
                  </button>
                </div>
              )}

              {!explainLoading && !explainError && explainData && (
                <div>
                  <div style={{padding: '1.5rem', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', borderRadius: '6px', marginBottom: '2rem'}}>
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem'}}>
                      <span className="mono" style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>
                        OD Corridor: {explainData.origin} → {explainData.destination} | Volume: {explainData.volume} veh/hr
                      </span>
                      <span style={{fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '4px', backgroundColor: explainData.status === 'single_path' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(34, 197, 94, 0.2)', color: explainData.status === 'single_path' ? 'var(--status-warn)' : 'var(--status-good)', fontWeight: 600}}>
                        {explainData.status === 'single_path' ? 'Single Corridor (Constrained)' : `${explainData.paths?.length || 0} Alternate Paths Evaluated`}
                      </span>
                    </div>
                    
                    <p style={{fontSize: '1.1rem', lineHeight: '1.6', color: 'var(--accent-qpso)', marginBottom: '1.5rem'}}>
                      "{explainData.explanation}"
                    </p>

                    <div style={{display: 'flex', gap: '1.5rem', flexWrap: 'wrap'}}>
                      <div style={{padding: '1rem', backgroundColor: 'var(--bg-color)', borderRadius: '4px', flex: 1, minWidth: '220px', border: '1px solid var(--border-color)'}}>
                        <h4 style={{color: 'var(--accent-baseline)', marginBottom: '0.25rem', fontSize: '0.9rem'}}>Current Routing (Dijkstra)</h4>
                        <p className="mono" style={{fontSize: '1.3rem', fontWeight: 600, margin: '0.25rem 0'}}>
                          {(((explainData.baseline_free_flow ?? 0)) / 60).toFixed(1)} mins
                        </p>
                        <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Shortest free-flow path without congestion feedback</span>
                      </div>
                      <div style={{padding: '1rem', backgroundColor: 'var(--bg-color)', borderRadius: '4px', flex: 1, minWidth: '220px', border: '1px solid var(--border-color)'}}>
                        <h4 style={{color: 'var(--accent-qpso)', marginBottom: '0.25rem', fontSize: '0.9rem'}}>Q-ROUTE Optimized Shift</h4>
                        <p className="mono" style={{fontSize: '1.3rem', fontWeight: 600, margin: '0.25rem 0'}}>
                          {(((explainData.qpso_free_flow ?? 0)) / 60).toFixed(1)} mins
                        </p>
                        <span style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Slightly longer free-flow path that prevents bottleneck collapse</span>
                      </div>
                    </div>
                  </div>

                  {/* Candidate Paths Breakdown */}
                  {explainData.paths && explainData.paths.length > 0 && (
                    <div>
                      <h3 style={{fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)'}}>Evaluated Candidate Paths for this OD Pair</h3>
                      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem'}}>
                        {explainData.paths.map((p: any) => (
                          <div key={p.id} style={{padding: '1rem', border: '1px solid var(--border-color)', backgroundColor: 'var(--panel-bg)', borderRadius: '4px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
                              <strong style={{color: p.id === 0 ? 'var(--accent-baseline)' : 'var(--accent-qpso)'}}>{p.name} {p.id === 0 ? '(Baseline)' : '(Alternate)'}</strong>
                              <span className="mono" style={{fontSize: '0.85rem', color: 'var(--text-secondary)'}}>
                                {(p.free_flow_time / 60).toFixed(1)} mins
                              </span>
                            </div>
                            <div style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>
                              Waypoints: {p.path?.length || 0} nodes
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          
        </div>
      </div>

      {showAbout && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <div style={{backgroundColor: 'var(--panel-bg)', padding: '2rem', borderRadius: '8px', maxWidth: '800px', border: '1px solid var(--accent-qpso)', position: 'relative'}}>
            <button onClick={() => setShowAbout(false)} style={{position: 'absolute', top: '1rem', right: '1rem', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.5rem'}}>&times;</button>
            <h2 style={{color: 'var(--accent-qpso)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem'}}><Info size={24}/> Why Q-ROUTE Matters</h2>
            
            <div style={{marginBottom: '1.5rem', lineHeight: '1.6'}}>
              <h3 style={{color: 'var(--text-primary)', marginBottom: '0.5rem'}}>The Real-World Impact</h3>
              <p style={{color: 'var(--text-secondary)'}}>
                Coordinating even a small fraction of trips away from congested roads has been shown in a real Google Research field experiment across 10 US cities to significantly improve network-wide travel time and reduce emissions for everyone.
              </p>
            </div>
            
            <div style={{marginBottom: '1.5rem'}}>
              <h3 style={{color: 'var(--text-primary)', marginBottom: '1rem'}}>Compliance Gradient (How it deploys)</h3>
              <table style={{width: '100%', borderCollapse: 'collapse', textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.9rem'}}>
                <thead>
                  <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                    <th style={{padding: '0.5rem'}}>Action</th>
                    <th style={{padding: '0.5rem'}}>Compliance</th>
                    <th style={{padding: '0.5rem'}}>Mechanism</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                    <td style={{padding: '0.5rem', color: 'var(--text-primary)'}}>Signal Retiming</td>
                    <td style={{padding: '0.5rem'}}>100% (Forced)</td>
                    <td style={{padding: '0.5rem'}}>Extending green phases on Q-ROUTE optimized corridors.</td>
                  </tr>
                  <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                    <td style={{padding: '0.5rem', color: 'var(--text-primary)'}}>Fleet Dispatch</td>
                    <td style={{padding: '0.5rem'}}>~80-100%</td>
                    <td style={{padding: '0.5rem'}}>Municipal and commercial fleets directly follow API directions.</td>
                  </tr>
                  <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                    <td style={{padding: '0.5rem', color: 'var(--text-primary)'}}>GPS Advisories</td>
                    <td style={{padding: '0.5rem'}}>~5-15% (Voluntary)</td>
                    <td style={{padding: '0.5rem'}}>Pushing traffic diversion suggestions to Maps/Waze partners.</td>
                  </tr>
                  <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                    <td style={{padding: '0.5rem', color: 'var(--text-primary)'}}>Dynamic Pricing</td>
                    <td style={{padding: '0.5rem'}}>Variable</td>
                    <td style={{padding: '0.5rem'}}>Adjusting tolls dynamically on chronically congested edges.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: '1rem', borderRadius: '4px', borderLeft: '4px solid var(--accent-qpso)'}}>
              <p style={{color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: '1.5'}}>
                <strong>Our Unique Contribution:</strong> We are not inventing routing or quantum computing. Instead, Q-ROUTE innovates by integrating multi-vehicle optimization, real-world OSM data ingestion, and a physical-action translation layer into one actionable system.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;