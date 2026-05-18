use crate::services::notes::{default_store, AppConfig, AppError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
struct AiChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<String>>,
    stream: bool,
}

#[derive(Debug, Clone, Serialize)]
struct AiFimRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    suffix: Option<String>,
    max_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<String>>,
    stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefix: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
struct AiChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Clone, Deserialize)]
struct ChatChoice {
    message: ChatMessageResponse,
}

#[derive(Debug, Clone, Deserialize)]
struct ChatMessageResponse {
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct AiFimResponse {
    choices: Vec<FimChoice>,
}

#[derive(Debug, Clone, Deserialize)]
struct FimChoice {
    text: String,
}

fn load_ai_config() -> Result<AppConfig, AppError> {
    let config = default_store()?.load_config()?;
    if !config.ai_enabled {
        return Err(AppError {
            code: "aiDisabled".into(),
            message: "AI Agent 未启用".into(),
        });
    }
    if config.ai_api_key.trim().is_empty() {
        return Err(AppError {
            code: "aiNoKey".into(),
            message: "未配置 AI API Key".into(),
        });
    }
    Ok(config)
}

fn build_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError {
            code: "aiHttp".into(),
            message: format!("failed to create HTTP client: {e}"),
        })
}

async fn send_chat_request(
    client: &reqwest::Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<String, AppError> {
    let body = AiChatRequest {
        model: model.into(),
        messages,
        max_tokens: 4096,
        temperature: 0.7,
        stop: None,
        stream: false,
    };

    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError {
            code: "aiHttp".into(),
            message: format!("AI 请求失败: {e}"),
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error_body = response.text().await.unwrap_or_default();
        return Err(AppError {
            code: "aiApi".into(),
            message: format!("AI API 错误 {status}: {error_body}"),
        });
    }

    let data: AiChatResponse = response.json().await.map_err(|e| AppError {
        code: "aiJson".into(),
        message: format!("解析 AI 响应失败: {e}"),
    })?;

    data.choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .ok_or_else(|| AppError {
            code: "aiEmpty".into(),
            message: "AI 返回空响应".into(),
        })
}

#[tauri::command]
pub async fn ai_chat(prompt: String, context: Option<String>) -> Result<String, AppError> {
    let config = load_ai_config()?;
    let client = build_client()?;

    let mut messages = Vec::new();

    if let Some(ctx) = context {
        if !ctx.trim().is_empty() {
            messages.push(ChatMessage {
                role: "system".into(),
                content: format!("你是一个写作助手。以下是要处理的上下文内容：\n\n{ctx}"),
                prefix: None,
            });
        }
    }

    messages.push(ChatMessage {
        role: "user".into(),
        content: prompt,
        prefix: None,
    });

    let endpoint = format!("{}/chat/completions", config.ai_api_endpoint.trim_end_matches('/'));
    send_chat_request(&client, &endpoint, config.ai_api_key.trim(), &config.ai_model, messages).await
}

#[tauri::command]
pub async fn ai_prefix_completion(prefix: String, prompt: Option<String>) -> Result<String, AppError> {
    let config = load_ai_config()?;
    let client = build_client()?;

    let mut messages = Vec::new();

    if let Some(p) = prompt {
        if !p.trim().is_empty() {
            messages.push(ChatMessage {
                role: "system".into(),
                content: format!("请续写以下文本，从给定的前缀开始：\n\n{p}"),
                prefix: None,
            });
        }
    }

    messages.push(ChatMessage {
        role: "assistant".into(),
        content: prefix,
        prefix: Some(true),
    });

    let endpoint = format!("{}/chat/completions", config.ai_api_endpoint.trim_end_matches('/'));
    send_chat_request(&client, &endpoint, config.ai_api_key.trim(), &config.ai_model, messages).await
}

#[tauri::command]
pub async fn ai_fim_completion(prefix: String, suffix: String) -> Result<String, AppError> {
    let config = load_ai_config()?;
    let client = build_client()?;

    let body = AiFimRequest {
        model: config.ai_model.clone(),
        prompt: prefix,
        suffix: Some(suffix),
        max_tokens: 2048,
        temperature: 0.3,
        stop: None,
        stream: false,
    };

    let endpoint = format!("{}/completions", config.ai_fim_endpoint.trim_end_matches('/'));

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", config.ai_api_key.trim()))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError {
            code: "aiHttp".into(),
            message: format!("AI 请求失败: {e}"),
        })?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let error_body = response.text().await.unwrap_or_default();
        return Err(AppError {
            code: "aiApi".into(),
            message: format!("AI API 错误 {status}: {error_body}"),
        });
    }

    let data: AiFimResponse = response.json().await.map_err(|e| AppError {
        code: "aiJson".into(),
        message: format!("解析 AI 响应失败: {e}"),
    })?;

    data.choices
        .into_iter()
        .next()
        .map(|choice| choice.text)
        .ok_or_else(|| AppError {
            code: "aiEmpty".into(),
            message: "AI 返回空响应".into(),
        })
}

#[tauri::command]
pub async fn ai_generate_title(content: String) -> Result<String, AppError> {
    let config = load_ai_config()?;
    let client = build_client()?;

    let messages = vec![ChatMessage {
        role: "user".into(),
        content: format!(
            "为以下内容生成一个简洁的标题（不超过20个字，只返回标题文本，不要引号或额外说明）：\n\n{content}"
        ),
        prefix: None,
    }];

    let endpoint = format!("{}/chat/completions", config.ai_api_endpoint.trim_end_matches('/'));
    let result = send_chat_request(&client, &endpoint, config.ai_api_key.trim(), &config.ai_title_model, messages).await?;
    Ok(result.trim().trim_matches('"').trim_matches('"').trim_matches('「').trim_matches('」').trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_chat_request() {
        let body = AiChatRequest {
            model: "deepseek-v4-pro".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: "Hello".into(),
                prefix: None,
            }],
            max_tokens: 1024,
            temperature: 0.7,
            stop: None,
            stream: false,
        };

        let json = serde_json::to_string(&body).expect("serialize");
        assert!(json.contains("deepseek-v4-pro"));
        assert!(json.contains("user"));
        assert!(json.contains("Hello"));
        assert!(json.contains("max_tokens"));
        assert!(!json.contains("prefix"));
    }

    #[test]
    fn serializes_chat_prefix_request() {
        let body = AiChatRequest {
            model: "deepseek-v4-pro".into(),
            messages: vec![
                ChatMessage {
                    role: "user".into(),
                    content: "Write quick sort".into(),
                    prefix: None,
                },
                ChatMessage {
                    role: "assistant".into(),
                    content: "```python\n".into(),
                    prefix: Some(true),
                },
            ],
            max_tokens: 4096,
            temperature: 0.7,
            stop: Some(vec!["```".into()]),
            stream: false,
        };

        let json = serde_json::to_string(&body).expect("serialize");
        assert!(json.contains("\"prefix\":true"));
        assert!(json.contains("```python"));
        assert!(json.contains("\"stop\":"));
    }

    #[test]
    fn serializes_fim_request() {
        let body = AiFimRequest {
            model: "deepseek-v4-pro".into(),
            prompt: "def fib(a):".into(),
            suffix: Some("    return fib(a-1) + fib(a-2)".into()),
            max_tokens: 128,
            temperature: 0.3,
            stop: None,
            stream: false,
        };

        let json = serde_json::to_string(&body).expect("serialize");
        assert!(json.contains("\"prompt\":"));
        assert!(json.contains("\"suffix\":"));
        assert!(json.contains("def fib(a):"));
    }

    #[test]
    fn deserializes_chat_response() {
        let json = r#"{"choices":[{"message":{"content":"def quick_sort(arr):"}}]}"#;
        let resp: AiChatResponse = serde_json::from_str(json).expect("deserialize");
        assert_eq!(
            resp.choices[0].message.content,
            "def quick_sort(arr):"
        );
    }

    #[test]
    fn deserializes_fim_response() {
        let json = r#"{"choices":[{"text":"    if n <= 1:\n        return a"}]}"#;
        let resp: AiFimResponse = serde_json::from_str(json).expect("deserialize");
        assert_eq!(resp.choices[0].text, "    if n <= 1:\n        return a");
    }
}
