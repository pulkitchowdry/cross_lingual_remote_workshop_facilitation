def test_health_does_not_require_auth(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_does_not_force_model_loads(client, monkeypatch):
    """Railway's healthcheck hits /health directly on every boot — it must not
    force NLLB/whisper/Piper to construct, or a single healthcheck poll loads
    ~1.5-2GB of models before any real request arrives."""
    from app.models import nllb, piper, whisper

    def _fail(*args, **kwargs):
        raise AssertionError("is_loaded() must not construct the model")

    monkeypatch.setattr(nllb, "_translator", _fail)
    monkeypatch.setattr(nllb, "_tokenizer", _fail)
    monkeypatch.setattr(whisper, "_model", _fail)
    monkeypatch.setattr(piper, "_voice", _fail)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["modelsLoaded"] == {"nllb": False, "whisper": False, "piper": False}
