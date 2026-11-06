"""Optional MLflow OSS spans; the local SQLite trace ledger always remains available."""

import os
from contextlib import contextmanager
from functools import wraps


def traced(name):
    def decorate(function):
        @wraps(function)
        def invoke(self, *args, **kwargs):
            with self.observability.span(name, inputs={"args": args, "kwargs": kwargs}) as span:
                result = function(self, *args, **kwargs)
                if span:
                    span.set_outputs(result)
                return result
        return invoke
    return decorate


class Observability:
    def __init__(self):
        self.tracking_uri = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
        self.client = None
        if self.tracking_uri:
            try:
                import mlflow
            except ImportError as error:
                raise RuntimeError("Install arena-copilot[observability] to enable MLFLOW_TRACKING_URI") from error
            mlflow.set_tracking_uri(self.tracking_uri)
            mlflow.set_experiment(os.environ.get("MLFLOW_EXPERIMENT_NAME", "arena-copilot-local"))
            self.client = mlflow

    @contextmanager
    def span(self, name, inputs=None, attributes=None):
        if not self.client:
            yield None
            return
        with self.client.start_span(name=name, attributes=attributes or {}) as span:
            if inputs is not None:
                span.set_inputs(inputs)
            yield span
