//! 코어의 최근 처리 시간과 바인딩 계산 통계.
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;

#[derive(Clone, Default)]
pub(crate) struct Profiler(std::sync::Arc<Mutex<Records>>);

#[derive(Default)]
struct Records {
    next: u64,
    spans: VecDeque<Span>,
    bindings: BTreeMap<String, Binding>,
    evaluated: u64,
    skipped: u64,
    debounced: u64,
    coalesced: u64,
    batched: u64,
}

#[derive(Clone)]
struct Span {
    id: u64,
    category: String,
    target: String,
    app_id: String,
    app_name: String,
    ms: f64,
    evaluated: usize,
    skipped: usize,
    detail: String,
}

#[derive(Default)]
struct Binding {
    app_id: String,
    app_name: String,
    pointer: String,
    expr: String,
    calls: u64,
    skipped: u64,
    total: f64,
    max: f64,
}

fn label(category: &str) -> &str {
    match category {
        "command" => "명령 처리",
        "data.state_change" => "상태 반응",
        "data.view" => "화면 계산",
        "data.act" => "액션 실행",
        "data.source" => "원천 조회",
        "storage.flush" => "디스크 플러시",
        _ => category,
    }
}

impl Profiler {
    pub(crate) fn span(
        &self,
        category: &str,
        target: &str,
        app_id: &str,
        app_name: &str,
        ms: f64,
        evaluated: usize,
        skipped: usize,
        detail: &str,
    ) {
        if app_id == "profiler" && target != "benchmark" {
            return;
        }
        let mut r = self.0.lock().unwrap();
        r.next += 1;
        let span = Span {
            id: r.next,
            category: category.into(),
            target: target.into(),
            app_id: app_id.into(),
            app_name: app_name.into(),
            ms,
            evaluated,
            skipped,
            detail: detail.into(),
        };
        if r.spans.len() == 250 {
            r.spans.pop_front();
        }
        r.spans.push_back(span);
    }
    pub(crate) fn binding(
        &self,
        app_id: &str,
        app_name: &str,
        pointer: &str,
        expr: &str,
        duration_ms: Option<f64>,
    ) {
        if app_id == "profiler" {
            return;
        }
        let mut r = self.0.lock().unwrap();
        match duration_ms {
            Some(_) => r.evaluated += 1,
            None => r.skipped += 1,
        }
        let key = format!("{app_id}:{pointer}");
        let binding = r.bindings.entry(key).or_default();
        binding.app_id = app_id.into();
        binding.app_name = app_name.into();
        binding.pointer = pointer.into();
        binding.expr = expr.into();
        if let Some(ms) = duration_ms {
            binding.calls += 1;
            binding.total += ms;
            binding.max = binding.max.max(ms);
        } else {
            binding.skipped += 1;
        }
    }
    pub(crate) fn debounced(&self, coalesced: bool) {
        let mut r = self.0.lock().unwrap();
        r.debounced += 1;
        if coalesced {
            r.coalesced += 1;
        }
    }
    pub(crate) fn record_batched_steps(&self, n: usize) {
        self.0.lock().unwrap().batched += n as u64;
    }
    pub(crate) fn clear(&self) {
        *self.0.lock().unwrap() = Records::default();
    }
    pub(crate) fn snapshot(&self, category: &str) -> Value {
        let r = self.0.lock().unwrap();
        let spans: Vec<_> = r
            .spans
            .iter()
            .filter(|s| category.is_empty() || category == "all" || s.category == category)
            .cloned()
            .collect();
        let command: Vec<_> = r
            .spans
            .iter()
            .filter(|s| s.category == "command")
            .map(|s| s.ms)
            .collect();
        let (avg, p95, max, _) = stats(&command);
        let total = r.evaluated + r.skipped;
        let ratio = if total == 0 {
            0.0
        } else {
            r.skipped as f64 * 100.0 / total as f64
        };
        let mut groups: BTreeMap<String, Vec<&Span>> = BTreeMap::new();
        let mut app_groups: BTreeMap<String, Vec<&Span>> = BTreeMap::new();
        for s in &r.spans {
            groups.entry(s.category.clone()).or_default().push(s);
            if !s.app_id.is_empty() {
                app_groups.entry(s.app_id.clone()).or_default().push(s);
            }
        }
        let categories: Vec<_> = groups.iter().map(|(name, rows)| { let values: Vec<_> = rows.iter().map(|s| s.ms).collect(); let (avg,p95,max,total)=stats(&values); json!({"key":name,"category":name,"label":label(name),"calls":rows.len(),"avg_ms":avg,"p95_ms":p95,"max_ms":max,"total_ms":total}) }).collect();
        let apps: Vec<_> = app_groups.iter().map(|(id, rows)| { let values: Vec<_> = rows.iter().map(|s|s.ms).collect(); let (avg,_,max,total)=stats(&values); json!({"key":id,"app_id":id,"app_name":rows[0].app_name,"calls":rows.len(),"avg_ms":avg,"max_ms":max,"total_ms":total,"evaluated_bindings":rows.iter().map(|s|s.evaluated).sum::<usize>(),"skipped_bindings":rows.iter().map(|s|s.skipped).sum::<usize>()}) }).collect();
        let row = |s: &Span| json!({"key":s.id.to_string(),"id":s.id.to_string(),"category":s.category,"category_label":label(&s.category),"target":s.target,"app_id":s.app_id,"app_name":s.app_name,"duration_ms":s.ms,"bindings":format!("{} / {} 생략",s.evaluated,s.skipped),"detail":s.detail});
        let recent: Vec<_> = spans.iter().rev().map(row).collect();
        let mut slow = spans.clone();
        slow.sort_by(|a, b| b.ms.total_cmp(&a.ms));
        let slow: Vec<_> = slow.iter().take(30).map(row).collect();
        let mut binding_rows: Vec<_> = r.bindings.iter().map(|(key,b)| json!({"key":key,"app_id":b.app_id,"app_name":b.app_name,"binding":b.pointer,"expr":b.expr,"calls":b.calls,"skipped_calls":b.skipped,"avg_ms":if b.calls == 0 {0.0} else {b.total/b.calls as f64},"max_ms":b.max,"total_ms":b.total})).collect();
        binding_rows.sort_by(|a, b| {
            b["total_ms"]
                .as_f64()
                .unwrap_or(0.0)
                .total_cmp(&a["total_ms"].as_f64().unwrap_or(0.0))
        });
        let chart_series: Vec<_> = [ ("avg_ms", "평균(ms)"), ("max_ms", "최대(ms)") ].into_iter().map(|(key,name)| json!({"key":key,"name":name,"points":categories.iter().map(|c|json!({"x":c["label"],"y":c[key]})).collect::<Vec<_>>() })).collect();
        let metrics = vec![
            json!({"key":"avg","label":"평균 명령 응답","value":format!("{avg:.2}"),"unit":"ms","subtext":format!("P95 {p95:.2} ms")}),
            json!({"key":"max","label":"최대 응답 지연","value":format!("{max:.2}"),"unit":"ms","subtext":format!("기록 {}건",r.spans.len())}),
            json!({"key":"skip","label":"바인딩 생략률","value":format!("{ratio:.1}"),"unit":"%","subtext":format!("{}회 생략",r.skipped)}),
            json!({"key":"disk","label":"디스크 쓰기 병합","value":r.coalesced,"unit":"회","subtext":format!("디바운스 {}회",r.debounced)}),
        ];
        json!({"summary":{"total_spans":r.spans.len(),"avg_command_ms":avg,"p95_command_ms":p95,"max_command_ms":max,"binding_skip_ratio_pct":ratio,"evaluated_bindings":r.evaluated,"skipped_bindings":r.skipped,"debounced_state_saves":r.debounced,"coalesced_disk_writes":r.coalesced,"batched_action_steps":r.batched},"metrics":metrics,"chart_series":chart_series,"categories":categories,"apps":apps,"recent_spans":recent,"slowest_spans":slow,"slowest_bindings":binding_rows})
    }
}
fn stats(values: &[f64]) -> (f64, f64, f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let total: f64 = v.iter().sum();
    (
        total / v.len() as f64,
        v[((v.len() * 95).div_ceil(100)).saturating_sub(1)],
        *v.last().unwrap(),
        total,
    )
}

impl Profiler {
    fn merge(&self, other: &Profiler) {
        let other = other.0.lock().unwrap();
        let mut own = self.0.lock().unwrap();
        own.evaluated += other.evaluated;
        own.skipped += other.skipped;
        own.debounced += other.debounced;
        own.coalesced += other.coalesced;
        own.batched += other.batched;
        for span in &other.spans {
            own.next += 1;
            let mut span = span.clone();
            span.id = own.next;
            if own.spans.len() == 250 {
                own.spans.pop_front();
            }
            own.spans.push_back(span);
        }
        for (key, other) in &other.bindings {
            let binding = own.bindings.entry(key.clone()).or_default();
            binding.app_id = other.app_id.clone();
            binding.app_name = other.app_name.clone();
            binding.pointer = other.pointer.clone();
            binding.expr = other.expr.clone();
            binding.calls += other.calls;
            binding.skipped += other.skipped;
            binding.total += other.total;
            binding.max = binding.max.max(other.max);
        }
    }
}

pub(crate) fn request(
    inner: &std::sync::Arc<crate::Inner>,
    method: kaleidoscope_contract::data::HttpMethod,
    path: &str,
    query: &BTreeMap<String, String>,
    body: Option<Value>,
) -> Result<kaleidoscope_contract::registry::ConnectionReply, kaleidoscope_contract::CoreError> {
    use kaleidoscope_contract::{data::HttpMethod, registry::ConnectionReply, ErrorCode};
    if body.is_some() {
        return Err(crate::error::make(ErrorCode::InvalidRequest));
    }
    match (method, path) {
        (HttpMethod::Get, "/snapshot") => {}
        (HttpMethod::Post, "/clear") => inner.profiler.clear(),
        (HttpMethod::Post, "/benchmark") => benchmark(inner)?,
        _ => return Err(crate::error::make(ErrorCode::InvalidRequest)),
    }
    Ok(ConnectionReply {
        status: 200,
        mime: "application/json".into(),
        json: Some(
            inner
                .profiler
                .snapshot(query.get("category").map_or("all", String::as_str)),
        ),
        text: None,
        data_base64: None,
    })
}

fn benchmark(inner: &std::sync::Arc<crate::Inner>) -> Result<(), kaleidoscope_contract::CoreError> {
    use kaleidoscope_contract::{CoreReply, CoreRequest, ErrorCode};
    let started = std::time::Instant::now();
    let mut children = Vec::new();
    for index in 0..24 {
        let expr = if index < 2 {
            "$state.active_tab"
        } else {
            "$state.extra"
        };
        children.push(json!({"type":"text","value":{"expr":expr}}));
    }
    let steps: Vec<_> = ["a", "b", "c", "d"]
        .into_iter()
        .map(|key| json!({"set_state":key,"value":{"expr":"$state.active_tab + 1"}}))
        .collect();
    children.push(json!({"type":"button","label":"실행","on_click":steps}));
    let definition = json!({"id":"profiler-benchmark","name":"벤치마크","requires":{"blocks":4,"modules":{}},"state":{"active_tab":0,"extra":1,"a":0,"b":0,"c":0,"d":0},"ui":{"type":"stack","direction":"column","children":children}}).to_string();
    let dir = std::env::temp_dir().join(format!("kaleidoscope-benchmark-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|err| crate::error::io_error(&err))?;
    let run = (|| {
        let core = crate::Core::open_with_client(
            crate::CoreConfig {
                embedded_server: None,
                data_dir: dir.clone(),
                seed_definitions: vec![definition],
                server_url: inner.server_url.clone(),
                device_name: "벤치마크".into(),
            },
            inner.host.clone(),
            inner.registry.clone(),
        )?;
        let CoreReply::StateGet { snapshot } = core.handle(CoreRequest::StateGet {})? else {
            return Err(crate::error::make(ErrorCode::InvalidRequest));
        };
        let desktop = snapshot
            .shared
            .desktops
            .first()
            .ok_or_else(|| crate::error::make(ErrorCode::NotFound))?
            .id
            .clone();
        let CoreReply::WindowOpen { window } = core.handle(CoreRequest::WindowOpen {
            desktop_id: desktop,
            app_id: "profiler-benchmark".into(),
            rect: None,
        })?
        else {
            return Err(crate::error::make(ErrorCode::InvalidRequest));
        };
        core.handle(CoreRequest::DataAttach {
            window_id: window.id.clone(),
        })?;
        let mut state = window.state;
        for index in 0..20 {
            state.insert("active_tab".into(), json!(index));
            core.handle(CoreRequest::WindowSetState {
                window_id: window.id.clone(),
                state: state.clone(),
            })?;
        }
        core.handle(CoreRequest::DataAct {
            window_id: window.id.clone(),
            pointer: "/ui/children/24/on_click".into(),
            event: Value::Null,
            item: Value::Null,
        })?;
        core.flush_storage()?;
        inner.profiler.merge(&core.inner.profiler);
        Ok(())
    })();
    if let Err(err) = std::fs::remove_dir_all(&dir) {
        eprintln!("측정 임시 폴더 정리 실패: {err}");
    }
    run?;
    inner.profiler.span(
        "command",
        "benchmark",
        "profiler",
        "프로파일러",
        started.elapsed().as_secs_f64() * 1000.0,
        0,
        0,
        "측정 완료",
    );
    Ok(())
}
