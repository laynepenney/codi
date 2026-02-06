// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cross-platform transport helpers for IPC.

use std::io;
use std::path::Path;

use tokio::io::{AsyncRead, AsyncWrite};

pub trait IpcStreamTrait: AsyncRead + AsyncWrite {}
impl<T: AsyncRead + AsyncWrite> IpcStreamTrait for T {}

pub type IpcStream = Box<dyn IpcStreamTrait + Unpin + Send>;

#[cfg(unix)]
use tokio::net::UnixListener;
#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(windows)]
use tokio::net::windows::named_pipe::{ClientOptions, ServerOptions};

pub struct IpcListener {
    #[cfg(unix)]
    inner: UnixListener,
    #[cfg(windows)]
    name: String,
}

pub async fn bind(path: &Path) -> io::Result<IpcListener> {
    #[cfg(unix)]
    {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let inner = UnixListener::bind(path)?;
        Ok(IpcListener { inner })
    }

    #[cfg(windows)]
    {
        Ok(IpcListener {
            name: pipe_name_from_path(path),
        })
    }
}

pub async fn connect(path: &Path) -> io::Result<IpcStream> {
    #[cfg(unix)]
    {
        let stream = UnixStream::connect(path).await?;
        Ok(Box::new(stream))
    }

    #[cfg(windows)]
    {
        let name = pipe_name_from_path(path);
        let mut attempts = 0;
        loop {
            match ClientOptions::new().open(&name) {
                Ok(client) => return Ok(Box::new(client)),
                Err(err) if attempts < 50 => {
                    attempts += 1;
                    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                    continue;
                }
                Err(err) => return Err(err),
            }
        }
    }
}

impl IpcListener {
    pub async fn accept(&self) -> io::Result<IpcStream> {
        #[cfg(unix)]
        {
            let (stream, _addr) = self.inner.accept().await?;
            Ok(Box::new(stream))
        }

        #[cfg(windows)]
        {
            let server = ServerOptions::new().create(&self.name)?;
            server.connect().await?;
            Ok(Box::new(server))
        }
    }
}

pub fn cleanup(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }

    #[cfg(windows)]
    {
        let _ = path;
    }

    Ok(())
}

#[cfg(windows)]
fn pipe_name_from_path(path: &Path) -> String {
    let name = path.to_string_lossy().to_string();
    if name.starts_with(r"\\.\pipe\") {
        name
    } else {
        format!(r"\\.\pipe\{}", name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[cfg(windows)]
    #[tokio::test]
    async fn test_named_pipe_roundtrip() {
        let pipe_path = Path::new(r"\\.\pipe\codi-ipc-test");

        let listener = bind(pipe_path).await.expect("bind failed");

        let server_task = tokio::spawn(async move {
            let mut stream = listener.accept().await.expect("accept failed");
            let mut buf = [0u8; 5];
            stream.read_exact(&mut buf).await.expect("read failed");
            assert_eq!(&buf, b"hello");
            stream.write_all(b"world").await.expect("write failed");
            stream.flush().await.expect("flush failed");
        });

        let mut client = connect(pipe_path).await.expect("connect failed");
        client.write_all(b"hello").await.expect("client write failed");
        client.flush().await.expect("client flush failed");

        let mut buf = [0u8; 5];
        client.read_exact(&mut buf).await.expect("client read failed");
        assert_eq!(&buf, b"world");

        server_task.await.expect("server task failed");
    }
}
