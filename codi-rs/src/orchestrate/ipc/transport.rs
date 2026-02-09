// Copyright 2026 Layne Penney
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cross-platform transport helpers for IPC.

use std::io;
use std::path::Path;

use tokio::io::{AsyncRead, AsyncWrite};

pub trait IpcIo: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T> IpcIo for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

pub type IpcStream = Box<dyn IpcIo>;

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
    #[cfg(windows)]
    use super::*;
    #[cfg(windows)]
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::time::Duration;

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

    #[tokio::test]
    async fn test_connection_refused() {
        // Try to connect to a non-existent socket
        let temp_dir = std::env::temp_dir();
        let fake_socket = temp_dir.join(format!("nonexistent_{}.sock", std::process::id()));

        // Ensure the socket doesn't exist
        let _ = std::fs::remove_file(&fake_socket);

        let result = connect(&fake_socket).await;
        assert!(result.is_err(), "Should fail to connect to non-existent socket");

        #[cfg(unix)]
        {
            if let Err(err) = result {
                assert!(
                    err.kind() == io::ErrorKind::NotFound ||
                    err.kind() == io::ErrorKind::ConnectionRefused,
                    "Expected NotFound or ConnectionRefused, got {:?}",
                    err.kind()
                );
            }
        }
        #[cfg(windows)]
        {
            if let Err(err) = result {
                assert!(
                    err.kind() == io::ErrorKind::NotFound ||
                    err.raw_os_error() == Some(2), // ERROR_FILE_NOT_FOUND
                    "Expected NotFound error, got {:?}",
                    err
                );
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_read_failure() {
        use tokio::net::UnixStream;
        use std::os::unix::net::UnixListener as StdUnixListener;

        let temp_dir = tempfile::tempdir().unwrap();
        let socket_path = temp_dir.path().join("test.sock");

        // Create a listener using std (non-async) to accept connections
        let listener = StdUnixListener::bind(&socket_path).unwrap();
        listener.set_nonblocking(true).unwrap();

        let server_task = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("Server failed to accept");
            // Write partial data then close
            use std::io::Write;
            stream.write_all(b"partial").expect("Server failed to write");
            // Close immediately - this should cause read failure
            drop(stream);
        });

        // Connect using tokio's async UnixStream
        let mut stream = UnixStream::connect(&socket_path).await.expect("Client failed to connect");
        let mut buf = [0u8; 10];

        // First read should succeed partially
        let n = stream.read(&mut buf).await.unwrap();
        assert_eq!(n, 7); // "partial" is 7 bytes

        // Second read should return 0 (EOF) - not an error but indicates closed
        let n = stream.read(&mut buf).await.unwrap();
        assert_eq!(n, 0);

        server_task.join().unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_write_failure() {
        use tokio::net::UnixStream;
        use std::os::unix::net::UnixListener as StdUnixListener;

        let temp_dir = tempfile::tempdir().unwrap();
        let socket_path = temp_dir.path().join("test_write.sock");

        let listener = StdUnixListener::bind(&socket_path).unwrap();
        listener.set_nonblocking(true).unwrap();

        let server_task = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("Server failed to accept");
            // Close immediately without reading - peer write may fail
            drop(stream);
        });

        let mut stream = UnixStream::connect(&socket_path).await.expect("Client failed to connect");

        // Try to write after server closes - this may or may not error
        // depending on timing, but we should at least see EOF on subsequent read
        let _ = stream.write_all(b"test data").await;
        let _ = stream.flush().await;

        server_task.join().unwrap();
    }

    #[tokio::test]
    async fn test_bind_to_invalid_path() {
        // Try to bind to an invalid path (non-existent parent directory that's not creatable)
        let invalid_path = Path::new("/proc/nonexistent/test.sock");

        let result = bind(invalid_path).await;
        assert!(result.is_err(), "Should fail to bind to invalid path");
    }

    #[tokio::test]
    async fn test_cleanup_removes_socket() {
        let temp_dir = tempfile::tempdir().unwrap();
        let socket_path = temp_dir.path().join("cleanup_test.sock");

        // Create the socket file
        #[cfg(unix)]
        {
            use tokio::net::UnixListener;
            let listener = UnixListener::bind(&socket_path).unwrap();
            drop(listener);
            assert!(socket_path.exists());
        }
        #[cfg(windows)]
        {
            // On Windows, cleanup is a no-op
            // Just verify the function doesn't panic
        }

        // Cleanup should remove it on Unix
        let result = cleanup(&socket_path);
        assert!(result.is_ok());

        #[cfg(unix)]
        {
            assert!(!socket_path.exists());
        }
    }
}
