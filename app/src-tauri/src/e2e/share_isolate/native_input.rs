use serde_json::{json, Value};
use std::{thread, time::Duration};
use windows::Win32::Foundation::POINT;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEINPUT,
};
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

pub(crate) fn drag(
    from: (i32, i32),
    to: (i32, i32),
    before_release: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    unsafe {
        SetCursorPos(from.0, from.1).map_err(|error| error.to_string())?;
        let mouse = |flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        if SendInput(
            &[mouse(MOUSEEVENTF_LEFTDOWN)],
            std::mem::size_of::<INPUT>() as i32,
        ) != 1
        {
            return Err("could not press drag button".into());
        }
        let result = (|| {
            for step in 1..=20 {
                let x = from.0 + (to.0 - from.0) * step / 20;
                let y = from.1 + (to.1 - from.1) * step / 20;
                SetCursorPos(x, y).map_err(|error| error.to_string())?;
                thread::sleep(Duration::from_millis(35));
            }
            thread::sleep(Duration::from_millis(250));
            before_release()
        })();
        if SendInput(
            &[mouse(MOUSEEVENTF_LEFTUP)],
            std::mem::size_of::<INPUT>() as i32,
        ) != 1
        {
            return Err(format!(
                "could not release drag button; drag result: {result:?}"
            ));
        }
        result?;
    }
    Ok(())
}

pub(crate) fn click(x: i32, y: i32) -> Result<(), String> {
    click_with_report(x, y).map(|_| ())
}

/// 클릭을 한 번 보내고, 보낸 그대로를 기록으로 돌려준다.
///
/// 다시 클릭하지 않는다. 실패하면 어디까지 갔는지(커서 좌표와 SendInput
/// 반환 수)를 오류 문자열에 담는다.
pub(crate) fn click_with_report(x: i32, y: i32) -> Result<Value, String> {
    unsafe {
        SetCursorPos(x, y).map_err(|error| format!("SetCursorPos({x},{y}): {error}"))?;
        let mut cursor = POINT::default();
        let mut report = json!({"requested": {"x": x, "y": y}, "requested_inputs": 2});
        report["cursor"] = match GetCursorPos(&mut cursor) {
            Ok(()) => json!({"x": cursor.x, "y": cursor.y}),
            Err(error) => json!({"error": error.to_string()}),
        };
        let click = [
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTDOWN,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        let inserted = SendInput(&click, std::mem::size_of::<INPUT>() as i32);
        report["inserted_inputs"] = json!(inserted);
        if inserted != click.len() as u32 {
            return Err(format!("could not click the agent input; {report}"));
        }
        Ok(report)
    }
}

pub(super) fn press_key(key: u16) -> Result<(), String> {
    unsafe {
        let key = [
            INPUT {
                r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: windows::Win32::UI::Input::KeyboardAndMouse::KEYBDINPUT {
                        wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(key),
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: windows::Win32::UI::Input::KeyboardAndMouse::KEYBDINPUT {
                        wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(key),
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        if SendInput(&key, std::mem::size_of::<INPUT>() as i32) != key.len() as u32 {
            return Err("could not scroll the HTML frame".into());
        }
    }
    Ok(())
}

/// 실제 키보드로 문자열을 입력한다. KEYEVENTF_UNICODE라 배열과 무관하게 글자 그대로 들어간다.
pub(crate) fn type_text(text: &str) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_UNICODE, VIRTUAL_KEY,
    };
    let input = |scan: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT {
            wVk: VIRTUAL_KEY(0), wScan: scan,
            dwFlags: if up { KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } else { KEYEVENTF_UNICODE },
            time: 0, dwExtraInfo: 0,
        } },
    };
    for unit in text.encode_utf16() {
        let down = unsafe { SendInput(&[input(unit, false)], std::mem::size_of::<INPUT>() as i32) };
        let up = unsafe { SendInput(&[input(unit, true)], std::mem::size_of::<INPUT>() as i32) };
        if down != 1 || up != 1 {
            return Err(format!("SendInput 유니코드 입력을 보내지 못함: {unit}"));
        }
        thread::sleep(Duration::from_millis(5));
    }
    Ok(())
}

pub(crate) fn chord(modifiers: &[u16], key: u16) -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{INPUT_KEYBOARD, KEYBDINPUT, VIRTUAL_KEY};
    let input = |key, up| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT {
        wVk: VIRTUAL_KEY(key), wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, time: 0, dwExtraInfo: 0,
    } } };
    let send = |key, up| unsafe { SendInput(&[input(key, up)], std::mem::size_of::<INPUT>() as i32) == 1 };
    let mut ok = true;
    for &modifier in modifiers { ok &= send(modifier, false); }
    ok &= send(key, false);
    thread::sleep(Duration::from_millis(70));
    // 중간 입력 실패에도 놓는 입력은 전부 보낸다.
    ok &= send(key, true);
    for &modifier in modifiers.iter().rev() { ok &= send(modifier, true); }
    if ok { Ok(()) } else { Err("SendInput 조합 키를 모두 보내지 못함".into()) }
}
