import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from embedding_artifact_verifier import tree_sha256, verify_loaded_artifact


class ArtifactVerificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'model.bin').write_bytes(b'actual-model')
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_actual_and_nested_loaded_paths(self):
        expected = tree_sha256(self.root)
        self.assertEqual(verify_loaded_artifact(SimpleNamespace(_model_dir=self.root)), expected)
        nested = SimpleNamespace(model=SimpleNamespace(_model_dir=self.root))
        self.assertEqual(verify_loaded_artifact(nested), expected)
        self.assertEqual(verify_loaded_artifact(object(), loaded_path=self.root), expected)

    def test_loaded_path_must_match_the_declared_artifact_model_and_revision(self):
        model_root = self.root / 'models--fixture--artifact' / 'snapshots' / 'artifact-r1'
        model_root.mkdir(parents=True)
        (model_root / 'model.bin').write_bytes(b'actual-model')
        os.environ['ACE_EMBEDDING_ARTIFACT_MODEL'] = 'fixture/artifact'
        os.environ['ACE_EMBEDDING_ARTIFACT_REVISION'] = 'artifact-r1'
        self.assertEqual(verify_loaded_artifact(object(), loaded_path=model_root), tree_sha256(model_root))
        os.environ['ACE_EMBEDDING_ARTIFACT_MODEL'] = 'fixture/other'
        with self.assertRaisesRegex(RuntimeError, 'model mismatch'):
            verify_loaded_artifact(object(), loaded_path=model_root)

    def test_environment_cannot_substitute_for_unknown_loaded_model(self):
        os.environ['ACE_EMBEDDING_ARTIFACT_MODEL'] = 'unrelated/cached-model'
        os.environ['ACE_EMBEDDING_ARTIFACT_REVISION'] = 'a' * 40
        with self.assertRaisesRegex(RuntimeError, 'did not expose'):
            verify_loaded_artifact(object())

    def test_wrong_digest_and_revision_are_rejected(self):
        os.environ['ACE_EMBEDDING_ARTIFACT_DIGEST'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
            verify_loaded_artifact(object(), loaded_path=self.root)
        os.environ.pop('ACE_EMBEDDING_ARTIFACT_DIGEST')
        os.environ['ACE_EMBEDDING_ARTIFACT_REVISION'] = 'a' * 40
        with self.assertRaisesRegex(RuntimeError, 'revision mismatch'):
            verify_loaded_artifact(object(), loaded_path=self.root)

    def test_broken_links_and_incomplete_artifacts_are_rejected(self):
        link = self.root / 'missing.bin'
        link.symlink_to(self.root / 'nonexistent')
        with self.assertRaisesRegex(RuntimeError, 'broken'):
            tree_sha256(self.root)
        link.unlink()
        (self.root / 'weights.incomplete').write_bytes(b'partial')
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            tree_sha256(self.root)


if __name__ == '__main__':
    unittest.main()
